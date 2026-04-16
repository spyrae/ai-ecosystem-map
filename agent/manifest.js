'use strict';

const fs = require('fs');
const path = require('path');
const {
  inferProviderFromAsset,
  inferLocalTargetPath,
  inferProjectAssetTarget,
} = require('./pathing');

const MANIFEST_KIND = 'hcp-workspace-manifest';
const MANIFEST_VERSION = 1;
const SUPPORTED_ASSET_TYPES = new Set(['skill', 'agent', 'mcp', 'instruction', 'rule']);

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

function readText(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

function readJson(filePath) {
  const text = readText(filePath);
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

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function extractMcpEntry(doc, provider, name) {
  const key = provider === 'continue_dev' ? 'servers' : (doc.mcpServers ? 'mcpServers' : 'servers');
  return doc?.[key]?.[name] || null;
}

function setMcpEntry(doc, provider, name, value) {
  const key = provider === 'continue_dev' ? 'servers' : 'mcpServers';
  const next = { ...(doc || {}) };
  if (!next[key] || typeof next[key] !== 'object') next[key] = {};
  next[key][name] = value;
  return next;
}

function defaultContent(record) {
  if (record.type === 'skill') {
    return `---\nname: ${record.name}\ndescription: ""\n---\n\n# ${record.name}\n\n`;
  }
  if (record.type === 'agent') {
    return `---\nname: ${record.name}\ndescription: ""\nmodel: sonnet\n---\n\n# ${record.name}\n\n`;
  }
  return `# ${record.name}\n\n`;
}

function buildAssetManifestKey(record) {
  return [
    record.scope || 'local',
    record.provider || 'unknown',
    record.type,
    record.name,
    record.projectPath || '',
  ].join(':');
}

function buildAssetRecord(asset, context = {}) {
  if (!asset || !SUPPORTED_ASSET_TYPES.has(asset.type)) return null;
  const provider = inferProviderFromAsset(asset, asset.providers?.[0] || null);
  const scope = asset.projectPath ? 'project' : 'local';
  const filePath = asset.filePath || null;
  const fileName = filePath ? path.basename(filePath) : `${asset.name}.md`;
  const project = asset.projectPath ? context.projectByPath?.get(asset.projectPath) || null : null;

  let content = null;
  let rawConfig = clone(asset.rawConfig || null);
  if (asset.type === 'mcp') {
    if (!rawConfig && filePath) {
      rawConfig = extractMcpEntry(readJson(filePath), provider, asset.name);
    }
  } else {
    content = filePath ? readText(filePath) : null;
  }

  return {
    key: buildAssetManifestKey({
      scope,
      provider,
      type: asset.type,
      name: asset.name,
      projectPath: asset.projectPath || null,
    }),
    name: asset.name,
    type: asset.type,
    scope,
    provider,
    fileName,
    filePath,
    projectPath: asset.projectPath || null,
    projectName: project?.name || null,
    projectType: project?.project_type || null,
    description: asset.desc || asset.description || '',
    category: asset.cat || asset.category || '',
    providers: Array.isArray(asset.providers) ? asset.providers : [],
    tags: Array.isArray(asset.tags) ? asset.tags : [],
    keywords: asset.keywords || '',
    deps: Array.isArray(asset.deps) ? asset.deps : [],
    content,
    rawConfig,
  };
}

function collectProjectAssets(opts, selectionSet = null) {
  const projectByPath = new Map();
  const records = [];
  const localProjects = (opts.getProjects?.() || []).filter((project) => project.environment_type !== 'remote');
  for (const project of localProjects) {
    projectByPath.set(project.path, project);
    const assets = opts.scanProjectAssets
      ? opts.scanProjectAssets(project.path, {
        environmentId: project.environment_id || opts.getLocalEnvironmentId?.() || null,
        environmentType: 'local',
      })
      : [];
    for (const asset of assets) {
      if (!SUPPORTED_ASSET_TYPES.has(asset.type)) continue;
      if (selectionSet && !selectionSet.has(asset.id)) continue;
      const record = buildAssetRecord({ ...asset, projectPath: project.path }, { projectByPath });
      if (record) records.push(record);
    }
  }
  return { records, projectByPath, localProjects };
}

function collectLocalAssets(opts, selectionSet = null) {
  const localEnvironmentId = opts.getLocalEnvironmentId?.() || null;
  const assets = opts.getAssets ? opts.getAssets(localEnvironmentId ? { environment_id: localEnvironmentId } : {}) : [];
  return assets
    .filter((asset) => SUPPORTED_ASSET_TYPES.has(asset.type))
    .filter((asset) => !selectionSet || selectionSet.has(asset.id))
    .map((asset) => buildAssetRecord(asset))
    .filter(Boolean);
}

function exportManifest(selection = {}, opts = {}) {
  const assetSelection = Array.isArray(selection.assetIds) && selection.assetIds.length
    ? new Set(selection.assetIds)
    : null;
  const bundleSelection = Array.isArray(selection.bundleIds) && selection.bundleIds.length
    ? new Set(selection.bundleIds)
    : null;
  const policySelection = Array.isArray(selection.policyIds) && selection.policyIds.length
    ? new Set(selection.policyIds)
    : null;

  const projectAssets = selection.includeAssets === false
    ? { records: [], projectByPath: new Map(), localProjects: [] }
    : collectProjectAssets(opts, assetSelection);

  const localAssets = selection.includeAssets === false
    ? []
    : collectLocalAssets(opts, assetSelection);

  const assets = [...localAssets, ...projectAssets.records]
    .filter((entry, index, source) => source.findIndex((candidate) => candidate.key === entry.key) === index)
    .sort((left, right) => left.key.localeCompare(right.key));

  const bundles = selection.includeBundles === false
    ? []
    : (opts.getBundles?.() || [])
      .filter((bundle) => !bundleSelection || bundleSelection.has(bundle.id))
      .map((bundle) => ({
        id: bundle.id,
        name: bundle.name,
        description: bundle.description || '',
        currentVersion: bundle.current_version,
        items: clone(bundle.items || []),
        versions: clone(bundle.versions || []),
        applications: clone(bundle.applications || []),
      }));

  const policies = selection.includePolicies === false
    ? []
    : (opts.getPolicies?.() || [])
      .filter((policy) => !policySelection || policySelection.has(policy.id))
      .map((policy) => ({
        id: policy.id,
        name: policy.name,
        description: policy.description || '',
        enabled: Boolean(policy.enabled),
        severity: policy.severity,
        selectors: clone(policy.selectors || {}),
        rules: clone(policy.rules || []),
      }));

  return {
    kind: MANIFEST_KIND,
    schemaVersion: MANIFEST_VERSION,
    exportedAt: Date.now(),
    source: {
      app: 'HCP',
      version: MANIFEST_VERSION,
    },
    summary: {
      assetCount: assets.length,
      bundleCount: bundles.length,
      policyCount: policies.length,
      projectCount: projectAssets.localProjects.length,
    },
    topology: {
      projects: projectAssets.localProjects.map((project) => ({
        id: project.id,
        name: project.name,
        path: project.path,
        projectType: project.project_type || null,
      })),
      providers: (opts.getProviderStats?.() || []).map((provider) => ({
        provider: provider.provider || provider.id || provider.name,
        count: provider.count || 0,
      })),
    },
    assets,
    bundles,
    policies,
  };
}

function parseManifest(raw) {
  const manifest = typeof raw === 'string' ? JSON.parse(raw) : clone(raw);
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Manifest must be an object');
  }
  if (manifest.kind !== MANIFEST_KIND) {
    throw new Error('Unsupported manifest kind');
  }
  if (manifest.schemaVersion !== MANIFEST_VERSION) {
    throw new Error(`Unsupported manifest schema version: ${manifest.schemaVersion}`);
  }
  manifest.assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  manifest.bundles = Array.isArray(manifest.bundles) ? manifest.bundles : [];
  manifest.policies = Array.isArray(manifest.policies) ? manifest.policies : [];
  return manifest;
}

function buildSyntheticAsset(record) {
  return {
    name: record.name,
    type: record.type,
    filePath: record.fileName ? path.join('/manifest', record.fileName) : null,
    providers: record.provider ? [record.provider] : [],
    projectPath: record.projectPath || null,
  };
}

function resolveAssetTarget(record, opts) {
  if (record.scope === 'project') {
    if (!record.projectPath) {
      return { targetPath: null, issue: 'Project-scoped asset is missing projectPath' };
    }
    const project = (opts.getProjects?.() || []).find((entry) => entry.path === record.projectPath && entry.environment_type !== 'remote');
    if (!project) {
      return { targetPath: null, issue: `Project "${record.projectPath}" is not available locally` };
    }
    const targetPath = record.type === 'mcp'
      ? path.join(project.path, '.mcp.json')
      : inferProjectAssetTarget(
        record.fileName ? path.join('/manifest', record.fileName) : null,
        project.path,
        record.type,
        record.provider || null
      );
    return { targetPath, project };
  }

  const targetPath = record.type === 'mcp'
    ? inferLocalTargetPath(buildSyntheticAsset(record), opts.projectRoot)
    : inferLocalTargetPath(buildSyntheticAsset(record), opts.projectRoot);
  return { targetPath, project: null };
}

function readCurrentAssetValue(record, targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) return null;
  if (record.type === 'mcp') {
    return extractMcpEntry(readJson(targetPath), record.provider, record.name);
  }
  return readText(targetPath);
}

function buildAssetPreview(record, opts) {
  const resolution = resolveAssetTarget(record, opts);
  if (!resolution.targetPath) {
    return {
      key: record.key || buildAssetManifestKey(record),
      name: record.name,
      type: record.type,
      scope: record.scope,
      provider: record.provider,
      action: 'blocked',
      targetPath: null,
      summary: resolution.issue || 'Unable to resolve target path',
      issues: [{ level: 'blocking', code: 'unresolved_target', message: resolution.issue || 'Unable to resolve target path' }],
      canApply: false,
    };
  }

  const currentValue = readCurrentAssetValue(record, resolution.targetPath);
  const nextValue = record.type === 'mcp' ? (record.rawConfig || null) : (record.content ?? defaultContent(record));
  const action = currentValue === null
    ? 'create'
    : (stableStringify(currentValue) === stableStringify(nextValue) ? 'noop' : 'update');

  return {
    key: record.key || buildAssetManifestKey(record),
    name: record.name,
    type: record.type,
    scope: record.scope,
    provider: record.provider,
    action,
    targetPath: resolution.targetPath,
    projectPath: record.projectPath || null,
    summary: action === 'create'
      ? `Create ${record.type} at ${resolution.targetPath}`
      : action === 'update'
        ? `Update ${record.type} at ${resolution.targetPath}`
        : `Keep ${record.type} at ${resolution.targetPath}`,
    issues: [],
    canApply: action !== 'noop',
    currentValue,
    nextValue,
  };
}

function buildBundlePreview(bundle, opts) {
  const existing = (opts.getBundles?.() || []).find((entry) => entry.name.toLowerCase() === String(bundle.name || '').toLowerCase()) || null;
  const nextValue = {
    description: bundle.description || '',
    items: clone(bundle.items || []),
  };
  if (!existing) {
    return {
      name: bundle.name,
      action: 'create',
      existingId: null,
      summary: `Create bundle "${bundle.name}"`,
      canApply: true,
      currentValue: null,
      nextValue,
    };
  }

  const currentValue = {
    description: existing.description || '',
    items: clone(existing.items || []),
  };
  const action = stableStringify(currentValue) === stableStringify(nextValue) ? 'noop' : 'update';
  return {
    name: bundle.name,
    action,
    existingId: existing.id,
    summary: action === 'update' ? `Update bundle "${bundle.name}"` : `Keep bundle "${bundle.name}"`,
    canApply: action !== 'noop',
    currentValue,
    nextValue,
  };
}

function buildPolicyPreview(policy, opts) {
  const existing = (opts.getPolicies?.() || []).find((entry) => entry.name.toLowerCase() === String(policy.name || '').toLowerCase()) || null;
  const nextValue = {
    description: policy.description || '',
    enabled: policy.enabled !== false,
    severity: policy.severity || 'warning',
    selectors: clone(policy.selectors || {}),
    rules: clone(policy.rules || []),
  };
  if (!existing) {
    return {
      name: policy.name,
      action: 'create',
      existingId: null,
      summary: `Create policy "${policy.name}"`,
      canApply: true,
      currentValue: null,
      nextValue,
    };
  }

  const currentValue = {
    description: existing.description || '',
    enabled: existing.enabled !== false,
    severity: existing.severity || 'warning',
    selectors: clone(existing.selectors || {}),
    rules: clone(existing.rules || []),
  };
  const action = stableStringify(currentValue) === stableStringify(nextValue) ? 'noop' : 'update';
  return {
    name: policy.name,
    action,
    existingId: existing.id,
    summary: action === 'update' ? `Update policy "${policy.name}"` : `Keep policy "${policy.name}"`,
    canApply: action !== 'noop',
    currentValue,
    nextValue,
  };
}

function previewImport(rawManifest, opts = {}) {
  const manifest = parseManifest(rawManifest);
  const assetResults = manifest.assets.map((record) => buildAssetPreview(record, opts));
  const bundleResults = manifest.bundles.map((bundle) => buildBundlePreview(bundle, opts));
  const policyResults = manifest.policies.map((policy) => buildPolicyPreview(policy, opts));

  const blockingIssues = assetResults.flatMap((entry) => entry.issues || []);
  const counts = {
    assets: {
      create: assetResults.filter((entry) => entry.action === 'create').length,
      update: assetResults.filter((entry) => entry.action === 'update').length,
      noop: assetResults.filter((entry) => entry.action === 'noop').length,
      blocked: assetResults.filter((entry) => entry.action === 'blocked').length,
    },
    bundles: {
      create: bundleResults.filter((entry) => entry.action === 'create').length,
      update: bundleResults.filter((entry) => entry.action === 'update').length,
      noop: bundleResults.filter((entry) => entry.action === 'noop').length,
    },
    policies: {
      create: policyResults.filter((entry) => entry.action === 'create').length,
      update: policyResults.filter((entry) => entry.action === 'update').length,
      noop: policyResults.filter((entry) => entry.action === 'noop').length,
    },
  };

  const writeCount = counts.assets.create + counts.assets.update + counts.bundles.create + counts.bundles.update + counts.policies.create + counts.policies.update;

  return {
    manifest: {
      kind: manifest.kind,
      schemaVersion: manifest.schemaVersion,
      exportedAt: manifest.exportedAt,
      summary: manifest.summary || null,
    },
    assets: assetResults,
    bundles: bundleResults,
    policies: policyResults,
    issues: blockingIssues,
    counts,
    writeCount,
    canApply: blockingIssues.length === 0 && writeCount > 0,
  };
}

function writeAssetRecord(record, previewEntry) {
  if (!previewEntry?.targetPath) return { action: 'skipped', reason: 'missing_target_path' };
  const targetPath = previewEntry.targetPath;
  ensureDir(targetPath);
  if (record.type === 'mcp') {
    const nextDoc = setMcpEntry(readJson(targetPath), record.provider, record.name, clone(record.rawConfig || {}));
    fs.writeFileSync(targetPath, JSON.stringify(nextDoc, null, 2), 'utf-8');
    return { action: previewEntry.action, targetPath };
  }
  fs.writeFileSync(targetPath, record.content ?? defaultContent(record), 'utf-8');
  return { action: previewEntry.action, targetPath };
}

function applyImport(rawManifest, opts = {}) {
  const manifest = parseManifest(rawManifest);
  const preview = previewImport(manifest, opts);
  if (preview.issues.length > 0) {
    return {
      ok: false,
      error: 'Manifest import is blocked',
      preview,
    };
  }

  const assetIndex = new Map(manifest.assets.map((record) => [record.key || buildAssetManifestKey(record), record]));
  const assetResults = [];
  for (const entry of preview.assets) {
    if (!['create', 'update'].includes(entry.action)) continue;
    const record = assetIndex.get(entry.key);
    if (!record) continue;
    assetResults.push(writeAssetRecord(record, entry));
  }

  for (const entry of preview.bundles) {
    const bundle = manifest.bundles.find((candidate) => candidate.name === entry.name);
    if (!bundle || !['create', 'update'].includes(entry.action)) continue;
    if (entry.action === 'create') {
      opts.createBundle?.({
        name: bundle.name,
        description: bundle.description || '',
        items: bundle.items || [],
        versionLabel: 'Imported from manifest',
      });
    } else if (entry.existingId) {
      opts.updateBundle?.(entry.existingId, {
        description: bundle.description || '',
        items: bundle.items || [],
        versionLabel: 'Imported from manifest',
      });
    }
  }

  for (const entry of preview.policies) {
    const policy = manifest.policies.find((candidate) => candidate.name === entry.name);
    if (!policy || !['create', 'update'].includes(entry.action)) continue;
    if (entry.action === 'create') {
      opts.createPolicy?.({
        name: policy.name,
        description: policy.description || '',
        enabled: policy.enabled !== false,
        severity: policy.severity || 'warning',
        selectors: policy.selectors || {},
        rules: policy.rules || [],
      });
    } else if (entry.existingId) {
      opts.updatePolicy?.(entry.existingId, {
        description: policy.description || '',
        enabled: policy.enabled !== false,
        severity: policy.severity || 'warning',
        selectors: policy.selectors || {},
        rules: policy.rules || [],
      });
    }
  }

  return {
    ok: true,
    preview,
    result: {
      assetWrites: assetResults.length,
      bundleWrites: preview.bundles.filter((entry) => ['create', 'update'].includes(entry.action)).length,
      policyWrites: preview.policies.filter((entry) => ['create', 'update'].includes(entry.action)).length,
      writeCount: preview.writeCount,
    },
  };
}

module.exports = {
  MANIFEST_KIND,
  MANIFEST_VERSION,
  exportManifest,
  previewImport,
  applyImport,
  parseManifest,
};
