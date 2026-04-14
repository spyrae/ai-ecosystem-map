'use strict';

const fs = require('fs');
const path = require('path');
const remote = require('./remote');
const { inspectGitContext } = require('./git');
const { getConnections, getTargetPath, getMcpConfigPath } = require('./connector');
const {
  inferProviderFromAsset,
  inferRemoteTargetPath,
  inferLocalTargetPath,
  inferProjectAssetTarget,
} = require('./pathing');

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = sortValue(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function readLocalText(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

function readLocalJson(filePath) {
  const text = readLocalText(filePath);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function sameSymlink(targetPath, sourcePath) {
  if (!fs.existsSync(targetPath)) return false;
  try {
    const stat = fs.lstatSync(targetPath);
    if (!stat.isSymbolicLink()) return false;
    const current = fs.readlinkSync(targetPath);
    return path.resolve(path.dirname(targetPath), current) === path.resolve(sourcePath);
  } catch {
    return false;
  }
}

function operation(action, mode, summary, extra = {}) {
  return {
    id: `${mode}:${extra.targetPath || extra.targetPathRemote || extra.sourcePath || summary}`,
    action,
    mode,
    summary,
    ...extra,
  };
}

function issue(level, code, message) {
  return { level, code, message };
}

function appendDependencyImpactWarnings(plan, asset, dependencyGraph) {
  const dependency = dependencyGraph?.byAssetId?.[asset?.id];
  if (!dependency || dependency.consumerCount === 0) return;

  const parts = [];
  if (dependency.assetConsumerCount) parts.push(`${dependency.assetConsumerCount} asset dependenc${dependency.assetConsumerCount === 1 ? 'y' : 'ies'}`);
  if (dependency.runtimeConsumerCount) parts.push(`${dependency.runtimeConsumerCount} running agent${dependency.runtimeConsumerCount === 1 ? '' : 's'}`);
  if (dependency.providerConsumerCount) parts.push(`${dependency.providerConsumerCount} provider connection${dependency.providerConsumerCount === 1 ? '' : 's'}`);

  plan.issues.push(issue(
    'warning',
    'downstream_impact',
    `This asset is currently used by ${parts.join(', ')}. Applying this sync can affect those downstream consumers.`
  ));
}

function applyGitPreflight(plan, projectPath, targetPath, action) {
  const git = inspectGitContext(projectPath, targetPath);
  if (!git) return;

  plan.target.git = git;
  if (action === 'noop') return;

  if (git.conflictedCount > 0) {
    plan.issues.push(issue(
      'blocking',
      'git_conflicts',
      `Target repo has merge conflicts on branch "${git.branch}". Resolve them before writing project config files.`
    ));
    return;
  }

  if (['conflicted', 'modified', 'staged', 'untracked'].includes(git.relevantStatus || '')) {
    plan.issues.push(issue(
      'blocking',
      'git_target_dirty',
      `Target path already has uncommitted git changes (${git.relevantStatus}) on branch "${git.branch}". Commit, stash, or discard them first.`
    ));
    return;
  }

  if (git.dirty) {
    plan.issues.push(issue(
      'warning',
      'git_repo_dirty',
      `Target repo is dirty on branch "${git.branch}" (${git.summary}). Review local changes before applying this sync.`
    ));
  }
}

function extractMcpEntryFromDocument(doc, provider, name) {
  const key = provider === 'continue_dev' ? 'servers' : (doc.mcpServers ? 'mcpServers' : 'servers');
  return doc[key]?.[name] || null;
}

function setMcpEntry(doc, provider, name, value) {
  const key = provider === 'continue_dev' ? 'servers' : 'mcpServers';
  const next = { ...(doc || {}) };
  if (!next[key] || typeof next[key] !== 'object') next[key] = {};
  next[key][name] = value;
  return next;
}

async function resolveSourceAsset(sourceInput, target, opts) {
  const {
    resolveAsset,
    getStoredAssetsByEnvironment,
  } = opts;

  if (!sourceInput || !sourceInput.type || (!sourceInput.assetId && !sourceInput.name && !sourceInput.filePath)) {
    return null;
  }

  const fromIndex = resolveAsset(sourceInput.assetId || sourceInput.name, sourceInput.type);
  if (fromIndex) return { ...fromIndex, providers: fromIndex.providers || [] };

  if (target.kind === 'server' && target.direction === 'pull' && target.serverId) {
    const remoteAssets = getStoredAssetsByEnvironment(target.serverId);
    const fromRemoteStore = remoteAssets.find((asset) =>
      asset.id === sourceInput.assetId ||
      (asset.name === sourceInput.name && asset.type === sourceInput.type) ||
      (sourceInput.filePath && asset.filePath === sourceInput.filePath)
    );
    if (fromRemoteStore) return { ...fromRemoteStore, providers: fromRemoteStore.providers || [] };
  }

  return {
    id: sourceInput.assetId || `${sourceInput.type}:${sourceInput.name}`,
    name: sourceInput.name,
    type: sourceInput.type,
    filePath: sourceInput.filePath || null,
    providers: Array.isArray(sourceInput.providers) ? sourceInput.providers : [],
    rawConfig: sourceInput.rawConfig || null,
    projectPath: sourceInput.projectPath || null,
  };
}

function enrichLocalMcpAsset(asset) {
  if (asset.type !== 'mcp' || asset.rawConfig || !asset.filePath) return asset;
  const provider = inferProviderFromAsset(asset);
  const doc = readLocalJson(asset.filePath);
  return {
    ...asset,
    rawConfig: extractMcpEntryFromDocument(doc, provider, asset.name),
  };
}

async function enrichRemoteMcpAsset(asset, client) {
  if (asset.type !== 'mcp' || asset.rawConfig || !asset.filePath) return asset;
  const provider = inferProviderFromAsset(asset);
  const raw = await remote.sshReadFile(client, asset.filePath);
  let doc = {};
  try { doc = raw ? JSON.parse(raw) : {}; } catch { doc = {}; }
  return {
    ...asset,
    rawConfig: extractMcpEntryFromDocument(doc, provider, asset.name),
  };
}

async function previewProjectSync(asset, target, opts) {
  const plan = {
    source: {
      assetId: asset.id,
      name: asset.name,
      type: asset.type,
      filePath: asset.filePath || null,
    },
    target: {
      kind: 'project',
      label: target.projectPath,
      projectPath: target.projectPath,
      method: target.method,
    },
    operations: [],
    issues: [],
    canApply: false,
    hasChanges: false,
  };

  if (asset.type === 'mcp') {
    const targetPath = path.join(target.projectPath, '.mcp.json');
    const sourceAsset = enrichLocalMcpAsset(asset);
    if (!sourceAsset.rawConfig) {
      plan.issues.push(issue('blocking', 'missing_source_config', 'MCP source config entry not found'));
      return plan;
    }

    const targetDoc = readLocalJson(targetPath);
    const targetEntry = extractMcpEntryFromDocument(targetDoc, 'claude', asset.name);
    const same = targetEntry && stableStringify(targetEntry) === stableStringify(sourceAsset.rawConfig);
    const action = same ? 'noop' : (targetEntry ? 'update' : 'create');
    plan.operations.push(operation(
      action,
      'json-entry-merge',
      `${action === 'create' ? 'Create' : action === 'update' ? 'Update' : 'Keep'} MCP entry "${asset.name}" in project config`,
      {
        targetPath,
        assetName: asset.name,
        entryValue: sourceAsset.rawConfig,
        provider: inferProviderFromAsset(asset),
      }
    ));
    applyGitPreflight(plan, target.projectPath, targetPath, action);
    plan.canApply = true;
    plan.hasChanges = action !== 'noop';
    return plan;
  }

  if (!asset.filePath) {
    plan.issues.push(issue('blocking', 'missing_source_path', 'Source asset has no file path'));
    return plan;
  }

  const targetPath = inferProjectAssetTarget(asset.filePath, target.projectPath, asset.type, asset.providers?.[0]);
  if (!targetPath) {
    plan.issues.push(issue('blocking', 'unsupported_target', `Project sync is not supported for type "${asset.type}"`));
    return plan;
  }

  if (asset.projectPath && path.resolve(asset.projectPath) === path.resolve(target.projectPath)) {
    plan.issues.push(issue('blocking', 'same_project', 'Source and target projects are the same'));
    return plan;
  }

  const sourceContent = readLocalText(asset.filePath);
  const exists = fs.existsSync(targetPath);
  const action = target.method === 'symlink'
    ? (sameSymlink(targetPath, asset.filePath) ? 'noop' : (exists ? 'update' : 'create'))
    : (!exists ? 'create' : (readLocalText(targetPath) === sourceContent ? 'noop' : 'update'));

  plan.operations.push(operation(
    action,
    target.method === 'symlink' ? 'file-symlink' : 'file-copy',
    `${action === 'create' ? 'Create' : action === 'update' ? 'Replace' : 'Keep'} ${asset.type} in target project`,
    {
      sourcePath: asset.filePath,
      targetPath,
      content: sourceContent,
    }
  ));
  applyGitPreflight(plan, target.projectPath, targetPath, action);
  plan.canApply = true;
  plan.hasChanges = action !== 'noop';
  if (action === 'update') {
    plan.issues.push(issue('warning', 'target_exists', 'Target already exists and will be replaced'));
  }
  return plan;
}

async function previewProviderSync(assetInput, target) {
  const asset = enrichLocalMcpAsset(assetInput);
  const provider = target.provider;
  const providerProjectRoot = target.projectPath || null;
  const plan = {
    source: {
      assetId: asset.id,
      name: asset.name,
      type: asset.type,
      filePath: asset.filePath || null,
    },
    target: {
      kind: 'provider',
      label: provider,
      provider,
      projectPath: providerProjectRoot,
    },
    operations: [],
    issues: [],
    canApply: false,
    hasChanges: false,
  };

  if (!provider) {
    plan.issues.push(issue('blocking', 'provider_required', 'Provider target is required'));
    return plan;
  }

  const connection = getConnections(
    asset.filePath || null,
    asset.type,
    asset.name,
    providerProjectRoot,
    asset.locations || null
  )[provider];

  if (connection && connection.installed === false) {
    plan.issues.push(issue(
      'warning',
      'provider_not_installed',
      `${provider} does not appear to be installed locally. Config files can still be written, but runtime pickup is not guaranteed.`
    ));
  }

  if (asset.type === 'mcp') {
    const targetPath = getMcpConfigPath(provider, providerProjectRoot);
    if (!targetPath) {
      plan.issues.push(issue('blocking', 'unsupported_target', `${provider} does not support MCP bundle sync for this scope`));
      return plan;
    }
    if (!asset.rawConfig) {
      plan.issues.push(issue('blocking', 'missing_source_config', 'MCP source config entry not found'));
      return plan;
    }

    const targetDoc = readLocalJson(targetPath);
    const targetEntry = extractMcpEntryFromDocument(targetDoc, provider, asset.name);
    const same = targetEntry && stableStringify(targetEntry) === stableStringify(asset.rawConfig);
    const action = same ? 'noop' : (targetEntry ? 'update' : 'create');
    plan.operations.push(operation(
      action,
      'provider-json-entry-merge',
      `${action === 'create' ? 'Create' : action === 'update' ? 'Update' : 'Keep'} MCP entry "${asset.name}" for ${provider}`,
      {
        targetPath,
        assetName: asset.name,
        entryValue: asset.rawConfig,
        provider,
      }
    ));
    plan.canApply = true;
    plan.hasChanges = action !== 'noop';
    return plan;
  }

  if (!asset.filePath) {
    plan.issues.push(issue('blocking', 'missing_source_path', 'Source asset has no file path'));
    return plan;
  }

  const targetPath = getTargetPath(provider, asset.type, asset.name, providerProjectRoot);
  if (!targetPath || targetPath === '__mcp__') {
    plan.issues.push(issue('blocking', 'unsupported_target', `${provider} does not support ${asset.type} bundle sync for this scope`));
    return plan;
  }

  const sourceContent = readLocalText(asset.filePath);
  const exists = fs.existsSync(targetPath);
  const action = connection?.connected && connection.isSymlink && sameSymlink(targetPath, asset.filePath)
    ? 'noop'
    : (!exists ? 'create' : (readLocalText(targetPath) === sourceContent ? 'noop' : 'update'));

  plan.operations.push(operation(
    action,
    'provider-file-link',
    `${action === 'create' ? 'Create' : action === 'update' ? 'Update' : 'Keep'} ${asset.type} for ${provider}`,
    {
      sourcePath: asset.filePath,
      targetPath,
      content: sourceContent,
      provider,
    }
  ));
  plan.canApply = true;
  plan.hasChanges = action !== 'noop';
  if (action === 'update') {
    plan.issues.push(issue('warning', 'target_exists', 'Provider target already exists and will be replaced'));
  }
  return plan;
}

async function previewServerSync(assetInput, target, opts) {
  const { getEnvironmentById, projectRoot } = opts;
  const env = getEnvironmentById(target.serverId);
  const plan = {
    source: {
      assetId: assetInput.id,
      name: assetInput.name,
      type: assetInput.type,
      filePath: assetInput.filePath || null,
    },
    target: {
      kind: 'server',
      label: env?.name || target.serverId,
      serverId: target.serverId,
      direction: target.direction,
    },
    operations: [],
    issues: [],
    canApply: false,
    hasChanges: false,
  };

  if (!env) {
    plan.issues.push(issue('blocking', 'server_not_found', 'Server environment not found'));
    return plan;
  }

  if (env.type !== 'remote') {
    plan.issues.push(issue('blocking', 'invalid_target', 'Sync preview is only supported for remote servers'));
    return plan;
  }

  const client = await remote.sshConnect(env);
  const home = (await remote.sshExec(client, 'echo $HOME')).trim();

  try {
    if (target.direction === 'push') {
      const asset = enrichLocalMcpAsset(assetInput);
      if (asset.type === 'mcp') {
        if (!asset.rawConfig) {
          plan.issues.push(issue('blocking', 'missing_source_config', 'MCP source config entry not found'));
          return plan;
        }
        const targetPath = inferRemoteTargetPath(home, asset);
        let remoteDoc = {};
        try {
          const raw = await remote.sshReadFile(client, targetPath);
          remoteDoc = raw ? JSON.parse(raw) : {};
        } catch {
          remoteDoc = {};
        }
        const targetEntry = extractMcpEntryFromDocument(remoteDoc, inferProviderFromAsset(asset), asset.name);
        const same = targetEntry && stableStringify(targetEntry) === stableStringify(asset.rawConfig);
        const action = same ? 'noop' : (targetEntry ? 'update' : 'create');
        plan.operations.push(operation(
          action,
          'remote-json-entry-merge',
          `${action === 'create' ? 'Create' : action === 'update' ? 'Update' : 'Keep'} remote MCP entry "${asset.name}"`,
          {
            targetPath,
            assetName: asset.name,
            entryValue: asset.rawConfig,
            provider: inferProviderFromAsset(asset),
          }
        ));
        plan.canApply = true;
        plan.hasChanges = action !== 'noop';
        return plan;
      }

      if (!asset.filePath) {
        plan.issues.push(issue('blocking', 'missing_source_path', 'Source asset has no file path'));
        return plan;
      }
      const sourceContent = readLocalText(asset.filePath);
      const targetPath = inferRemoteTargetPath(home, asset);
      if (!targetPath) {
        plan.issues.push(issue('blocking', 'unsupported_target', `Remote sync is not supported for type "${asset.type}"`));
        return plan;
      }
      const remoteContent = await remote.sshReadFile(client, targetPath).catch(() => null);
      const action = remoteContent === null ? 'create' : (remoteContent === sourceContent ? 'noop' : 'update');
      plan.operations.push(operation(
        action,
        'remote-file-copy',
        `${action === 'create' ? 'Create' : action === 'update' ? 'Update' : 'Keep'} remote ${asset.type}`,
        {
          sourcePath: asset.filePath,
          targetPath,
          content: sourceContent,
        }
      ));
      plan.canApply = true;
      plan.hasChanges = action !== 'noop';
      return plan;
    }

    const asset = await enrichRemoteMcpAsset(assetInput, client);
    if (asset.type === 'mcp') {
      if (!asset.rawConfig) {
        plan.issues.push(issue('blocking', 'missing_source_config', 'Remote MCP source config entry not found'));
        return plan;
      }
      const targetPath = inferLocalTargetPath(asset, projectRoot);
      const localDoc = readLocalJson(targetPath);
      const targetEntry = extractMcpEntryFromDocument(localDoc, inferProviderFromAsset(asset), asset.name);
      const same = targetEntry && stableStringify(targetEntry) === stableStringify(asset.rawConfig);
      const action = same ? 'noop' : (targetEntry ? 'update' : 'create');
      plan.operations.push(operation(
        action,
        'json-entry-merge',
        `${action === 'create' ? 'Create' : action === 'update' ? 'Update' : 'Keep'} local MCP entry "${asset.name}"`,
        {
          targetPath,
          assetName: asset.name,
          entryValue: asset.rawConfig,
          provider: inferProviderFromAsset(asset),
        }
      ));
      plan.canApply = true;
      plan.hasChanges = action !== 'noop';
      return plan;
    }

    if (!asset.filePath) {
      plan.issues.push(issue('blocking', 'missing_source_path', 'Remote asset has no file path'));
      return plan;
    }
    const sourceContent = await remote.sshReadFile(client, asset.filePath).catch(() => null);
    if (sourceContent === null) {
      plan.issues.push(issue('blocking', 'missing_remote_source', 'Remote source file not found'));
      return plan;
    }
    const targetPath = inferLocalTargetPath(asset, projectRoot);
    if (!targetPath) {
      plan.issues.push(issue('blocking', 'unsupported_target', `Local sync is not supported for type "${asset.type}"`));
      return plan;
    }
    const localContent = readLocalText(targetPath);
    const action = localContent === null ? 'create' : (localContent === sourceContent ? 'noop' : 'update');
    plan.operations.push(operation(
      action,
      'remote-file-pull',
      `${action === 'create' ? 'Create' : action === 'update' ? 'Update' : 'Keep'} local ${asset.type} from remote`,
      {
        sourcePath: asset.filePath,
        targetPath,
      }
    ));
    plan.canApply = true;
    plan.hasChanges = action !== 'noop';
    return plan;
  } finally {
    remote.sshDisconnect(env.id);
  }
}

async function previewSync(body, opts) {
  const source = await resolveSourceAsset(body.source, body.target, opts);
  if (!source) {
    return {
      source: body.source || null,
      target: body.target || null,
      operations: [],
      issues: [issue('blocking', 'source_not_found', 'Source asset could not be resolved')],
      canApply: false,
      hasChanges: false,
    };
  }

  if (body.target.kind === 'project') {
    const plan = await previewProjectSync(source, body.target, opts);
    appendDependencyImpactWarnings(plan, source, opts.dependencyGraph);
    return plan;
  }

  if (body.target.kind === 'provider') {
    const plan = await previewProviderSync(source, body.target);
    appendDependencyImpactWarnings(plan, source, opts.dependencyGraph);
    return plan;
  }

  if (body.target.kind === 'server') {
    const plan = await previewServerSync(source, body.target, opts);
    appendDependencyImpactWarnings(plan, source, opts.dependencyGraph);
    return plan;
  }

  return {
    source,
    target: body.target || null,
    operations: [],
    issues: [issue('blocking', 'unsupported_target', `Unsupported sync target kind "${body.target?.kind || 'unknown'}"`)],
    canApply: false,
    hasChanges: false,
  };
}

async function applyProjectOperation(op) {
  if (op.action === 'noop') return;
  if (op.mode === 'json-entry-merge') {
    const currentDoc = readLocalJson(op.targetPath);
    const nextDoc = setMcpEntry(currentDoc, op.provider, op.assetName, op.entryValue);
    ensureDir(op.targetPath);
    fs.writeFileSync(op.targetPath, JSON.stringify(nextDoc, null, 2), 'utf-8');
    return;
  }

  ensureDir(op.targetPath);
  if (fs.existsSync(op.targetPath)) fs.rmSync(op.targetPath, { force: true });
  if (op.mode === 'file-symlink') {
    fs.symlinkSync(path.resolve(op.sourcePath), op.targetPath);
    return;
  }
  fs.copyFileSync(op.sourcePath, op.targetPath);
}

async function applyProviderOperation(op) {
  if (op.action === 'noop') return;
  if (op.mode === 'provider-json-entry-merge') {
    const currentDoc = readLocalJson(op.targetPath);
    const nextDoc = setMcpEntry(currentDoc, op.provider, op.assetName, op.entryValue);
    ensureDir(op.targetPath);
    fs.writeFileSync(op.targetPath, JSON.stringify(nextDoc, null, 2), 'utf-8');
    return;
  }

  ensureDir(op.targetPath);
  if (fs.existsSync(op.targetPath)) fs.rmSync(op.targetPath, { force: true });
  try {
    fs.symlinkSync(path.resolve(op.sourcePath), op.targetPath);
  } catch {
    fs.copyFileSync(op.sourcePath, op.targetPath);
  }
}

async function applyServerOperations(plan, opts) {
  const env = opts.getEnvironmentById(plan.target.serverId);
  const client = await remote.sshConnect(env);
  try {
    for (const op of plan.operations) {
      if (op.action === 'noop') continue;
      if (op.mode === 'remote-json-entry-merge') {
        const raw = await remote.sshReadFile(client, op.targetPath).catch(() => null);
        let doc = {};
        try { doc = raw ? JSON.parse(raw) : {}; } catch { doc = {}; }
        const nextDoc = setMcpEntry(doc, op.provider, op.assetName, op.entryValue);
        await remote.sshWriteFile(client, op.targetPath, JSON.stringify(nextDoc, null, 2));
        continue;
      }
      if (op.mode === 'remote-file-copy') {
        await remote.scpPush(client, op.sourcePath, op.targetPath);
        continue;
      }
      if (op.mode === 'remote-file-pull') {
        await remote.scpPull(client, op.sourcePath, op.targetPath);
        continue;
      }
      if (op.mode === 'json-entry-merge') {
        const currentDoc = readLocalJson(op.targetPath);
        const nextDoc = setMcpEntry(currentDoc, op.provider, op.assetName, op.entryValue);
        ensureDir(op.targetPath);
        fs.writeFileSync(op.targetPath, JSON.stringify(nextDoc, null, 2), 'utf-8');
      }
    }
  } finally {
    remote.sshDisconnect(env.id);
  }
}

async function applySync(body, opts) {
  const plan = await previewSync(body, opts);
  if (!plan.canApply) {
    return { ok: false, plan, error: 'Sync plan is not applicable' };
  }

  const changedOps = plan.operations.filter((op) => op.action !== 'noop');
  if (body.target.kind === 'project') {
    for (const op of changedOps) {
      await applyProjectOperation(op);
    }
  } else if (body.target.kind === 'provider') {
    for (const op of changedOps) {
      await applyProviderOperation(op);
    }
  } else if (body.target.kind === 'server') {
    await applyServerOperations(plan, opts);
  } else {
    return { ok: false, plan, error: `Unsupported sync target kind "${body.target?.kind || 'unknown'}"` };
  }

  return {
    ok: true,
    plan,
    applied: changedOps.length,
    skipped: plan.operations.length - changedOps.length,
  };
}

module.exports = {
  previewSync,
  applySync,
};
