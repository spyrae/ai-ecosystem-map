'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { connect, disconnect, getConnections, getTargetPath, getMcpConfigPath } = require('./connector');
const store = require('./store');
const { discoverProjects, addProjectByPath, scanProjectAssets } = require('./projects');
const remote = require('./remote');
const mcpClient = require('./mcp-client');
const sync = require('./sync');
const batch = require('./batch');
const bundles = require('./bundles');
const manifest = require('./manifest');
const policies = require('./policies');
const remediation = require('./remediation');
const snapshots = require('./snapshots');
const { buildTopology } = require('./topology');
const { buildDependencyGraph } = require('./dependencies');
const { buildDriftGraph } = require('./drift');
const { inspectGitContext } = require('./git');
const { attachCapabilities } = require('./capabilities');
const { evaluateAssetHealth } = require('./health');
const mcpRuntime = require('./mcp-runtime');
const agentIntrospection = require('./agent-introspection');
const {
  inferProviderFromAsset,
  inferRemoteTargetPath,
  inferLocalTargetPath,
  inferProjectAssetTarget,
} = require('./pathing');

/**
 * Create API router
 */
function createRouter(ctx) {
  const { getData, getSourceIndex, rescan, claudeDir, projectRoot } = ctx;

  return function router(req, res, url) {
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };

    const readBody = () => new Promise((resolve) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve(null); }
      });
    });

    const resolveAsset = (assetRef, typeHint = null) => {
      if (!assetRef) return null;
      const sourceIndex = getSourceIndex();
      return sourceIndex[assetRef] || (typeHint ? sourceIndex[`${typeHint}:${assetRef}`] : null) || null;
    };

    const resolveStoredAsset = (assetRef, typeHint = null) => {
      const direct = resolveAsset(assetRef, typeHint);
      if (direct) return direct;
      const storedAssets = store.getAssets();
      return storedAssets.find((asset) => asset.id === assetRef)
        || (typeHint ? storedAssets.find((asset) => asset.type === typeHint && asset.name === assetRef) : null)
        || null;
    };

    const resolveRuntimeAsset = async (assetRef, typeHint = 'mcp') => {
      const direct = resolveStoredAsset(assetRef, typeHint);
      if (direct) return direct;

      const projects = store.getProjects();
      for (const project of projects) {
        let assets;
        if (project.environment_type === 'remote') {
          const env = getEnvironmentById(project.environment_id);
          if (!env) continue;
          assets = await remote.scanRemoteProjectAssets(env, project.path);
        } else {
          assets = scanProjectAssets(project.path, {
            environmentId: project.environment_id || store.getLocalEnvironmentId(),
            environmentType: 'local',
          });
        }

        const match = assets.find((asset) => asset.id === assetRef)
          || assets.find((asset) => asset.type === typeHint && asset.name === assetRef);
        if (match) return match;
      }

      const fallback = typeHint === 'mcp'
        ? mcpClient.getMcpConfig(assetRef, claudeDir, projectRoot)
        : null;
      if (!fallback) return null;
      return {
        id: `runtime:${typeHint}:${assetRef}`,
        name: assetRef,
        type: typeHint,
        filePath: fallback.source,
        rawConfig: fallback.config,
        providers: [],
        tags: [],
        deps: [],
        cat: typeHint === 'mcp' ? 'MCP Servers' : 'Other',
        desc: fallback.config?.description || `${typeHint} asset`,
      };
    };

    const resolveInstructionPath = (provider, scope) => {
      const isProject = scope === 'project';
      const HOME = process.env.HOME || '';
      const projectBase = projectRoot || process.cwd();

      switch (provider) {
        case 'claude':
          return path.join(isProject ? projectBase : claudeDir, 'CLAUDE.md');
        case 'codex':
          return isProject ? path.join(projectBase, 'AGENTS.md') : path.join(HOME, '.codex', 'instructions.md');
        case 'gemini':
          return isProject ? path.join(projectBase, 'GEMINI.md') : path.join(HOME, '.gemini', 'instructions.md');
        case 'copilot':
          return path.join(projectBase, '.github', 'copilot-instructions.md');
        case 'cursor':
          return path.join(projectBase, '.cursorrules');
        case 'windsurf':
          return path.join(projectBase, '.windsurfrules');
        default:
          return null;
      }
    };

    const requestClient = (() => {
      const raw = req.headers['x-hcp-client'] || req.headers['x-aem-client'];
      const value = Array.isArray(raw) ? raw[0] : raw;
      return typeof value === 'string' && value.trim() ? value.trim() : 'api';
    })();
    const buildActor = () => ({
      kind: 'local-session',
      user: process.env.USER || process.env.USERNAME || null,
      host: os.hostname(),
      client: requestClient,
    });
    const normalizeApproval = (approval, options = {}) => {
      const normalized = approval ? {
        required: Boolean(options.required || approval.required),
        confirmed: Boolean(approval.confirmed),
        note: typeof approval.note === 'string' && approval.note.trim() ? approval.note.trim() : null,
        reason: typeof approval.reason === 'string' && approval.reason.trim() ? approval.reason.trim() : null,
        source: typeof approval.source === 'string' && approval.source.trim() ? approval.source.trim() : requestClient,
      } : null;
      if (!normalized) {
        return options.required ? {
          required: true,
          confirmed: false,
          note: null,
          reason: options.reason || null,
          source: requestClient,
        } : null;
      }
      if (options.reason && !normalized.reason) {
        normalized.reason = options.reason;
      }
      return normalized;
    };
    const approvalRequiredResult = (reason) => ({
      ok: false,
      error: 'Approval required',
      approvalRequired: true,
      approval: {
        required: true,
        confirmed: false,
        note: null,
        reason,
        source: requestClient,
      },
    });
    const requireApproval = ({ required, approval, reason }) => {
      if (!required) return normalizeApproval(approval, { required: false, reason: null });
      const normalized = normalizeApproval(approval, { required: true, reason });
      if (!normalized?.confirmed) return approvalRequiredResult(reason);
      return normalized;
    };
    const buildHistoryTarget = (details = {}) => {
      const target = details.target;
      if (target?.kind === 'provider') {
        return {
          kind: 'provider',
          id: target.provider || null,
          label: target.provider || 'provider',
        };
      }
      if (target?.kind === 'project') {
        const projectPath = target.projectPath || details.projectPath || null;
        return {
          kind: 'project',
          id: details.projectId || projectPath,
          label: projectPath ? path.basename(projectPath) : 'project',
        };
      }
      if (target?.kind === 'server') {
        return {
          kind: 'server',
          id: target.serverId || details.serverId || null,
          label: details.serverName || details.to || details.from || target.serverId || 'server',
        };
      }
      if (details.projectId || details.projectPath) {
        return {
          kind: 'project',
          id: details.projectId || details.projectPath,
          label: details.projectName || path.basename(details.projectPath || details.projectId || 'project'),
        };
      }
      if (details.serverId || details.serverName || details.to || details.from) {
        return {
          kind: 'server',
          id: details.serverId || null,
          label: details.serverName || details.to || details.from || 'server',
        };
      }
      if (details.tool) {
        return {
          kind: 'provider',
          id: details.tool,
          label: details.tool,
        };
      }
      return null;
    };
    const buildHistoryEffect = (details = {}) => {
      const effect = {};
      if (typeof details.applied === 'number') effect.applied = details.applied;
      if (typeof details.skipped === 'number') effect.skipped = details.skipped;
      if (typeof details.total === 'number') effect.total = details.total;
      if (typeof details.restored === 'number') effect.restored = details.restored;
      if (typeof details.operationCount === 'number') effect.operationCount = details.operationCount;
      if (typeof details.resultCount === 'number') effect.resultCount = details.resultCount;
      return Object.keys(effect).length > 0 ? effect : null;
    };
    const summarizeHistoryAction = (action, assetName, details = {}) => {
      switch (action) {
        case 'sync':
          return `Synced ${assetName} to ${buildHistoryTarget(details)?.label || 'target'}`;
        case 'batch-sync':
          return `Applied batch sync for ${details.total || assetName}`;
        case 'connect':
          return `Connected ${assetName}${details.tool ? ` to ${details.tool}` : ''}`;
        case 'disconnect':
          return `Disconnected ${assetName}${details.tool ? ` from ${details.tool}` : ''}`;
        case 'delete':
          return `Deleted ${assetName}`;
        case 'create':
          return `Created ${assetName}`;
        case 'edit':
          return `Edited ${assetName}`;
        case 'rollback':
          return `Rolled back ${assetName}`;
        case 'undo':
          return `Undid latest change for ${assetName}`;
        case 'remediation':
          return details.title ? `Applied remediation: ${details.title}` : `Applied remediation for ${assetName}`;
        default:
          return `${action} ${assetName}`.trim();
      }
    };
    const buildHistoryPayload = (action, assetName, details = {}) => {
      const handledKeys = new Set([
        'summary',
        'snapshotId',
        'snapshot_id',
        'approval',
        'approvalRequired',
        'approvalReason',
        'assetId',
        'asset_id',
        'assetType',
        'type',
        'target',
        'metadata',
        'applied',
        'skipped',
        'total',
        'restored',
        'operationCount',
        'resultCount',
      ]);
      const metadata = {
        ...(details.metadata && typeof details.metadata === 'object' ? details.metadata : {}),
        ...Object.fromEntries(
        Object.entries(details).filter(([key]) => !handledKeys.has(key))
        ),
      };
      const approval = normalizeApproval(details.approval, {
        required: details.approvalRequired,
        reason: details.approvalReason,
      });
      const effect = buildHistoryEffect(details);
      return {
        assetId: details.assetId || details.asset_id || null,
        assetType: details.assetType || details.type || null,
        snapshotId: details.snapshotId || details.snapshot_id || null,
        summary: details.summary || summarizeHistoryAction(action, assetName, details),
        actor: buildActor(),
        approval,
        target: buildHistoryTarget(details),
        effect,
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
      };
    };
    const recordHistoryAction = (action, assetName, details = {}) => (
      store.recordAction(action, assetName, buildHistoryPayload(action, assetName, details))
    );

    const getEnvironmentById = (id) => store.getEnvironments().find((env) => env.id === id) || null;
    const getRunningAgentById = (id) => (store.getRunningAgents ? store.getRunningAgents() : []).find((agent) => agent.id === id) || null;
    const resolveAnyAsset = async (assetRef, typeHint = null) => {
      const direct = resolveStoredAsset(assetRef, typeHint);
      if (direct) return decorateAssetForResponse(direct);

      const projects = store.getProjects();
      for (const project of projects) {
        let assets;
        if (project.environment_type === 'remote') {
          const env = getEnvironmentById(project.environment_id);
          if (!env) continue;
          assets = await remote.scanRemoteProjectAssets(env, project.path);
        } else {
          assets = scanProjectAssets(project.path, {
            environmentId: project.environment_id || store.getLocalEnvironmentId(),
            environmentType: 'local',
          });
        }

        const match = assets.find((asset) => asset.id === assetRef)
          || (typeHint ? assets.find((asset) => asset.type === typeHint && asset.name === assetRef) : null);
        if (match) return decorateAssetForResponse(match);
      }

      return null;
    };
    const decorateRunningAgent = (agent) => {
      if (!agent) return agent;
      return {
        ...agent,
        introspection: agentIntrospection.getCachedIntrospection(agent),
      };
    };
    const decorateRunningAgentList = (agents) => (agents || []).map((agent) => decorateRunningAgent(agent));
    const runAgentIntrospection = (agent, options = {}) => agentIntrospection.checkRunningAgentIntrospection(agent, {
      force: options.force,
      timeoutMs: options.timeoutMs,
      environments: store.getEnvironments(),
      projects: store.getProjects(),
      localEnvironmentId: store.getLocalEnvironmentId(),
      localAssets: decorateAssetList(getData()),
      storedAssets: decorateAssetList(store.getAssets()),
      scanProjectAssets,
      remote,
    });
    const loadDriftGraph = () => buildDriftGraph({
      getData,
      store,
      scanProjectAssets,
      remote,
    });
    const getAuditMode = () => (store.getAuditMode ? store.getAuditMode() : {
      global_read_only: false,
      environments: [],
    });
    const decorateProject = (project) => {
      if (!project) return project;
      if (project.environment_type === 'remote') return { ...project, git: null };
      return {
        ...project,
        git: inspectGitContext(project.path),
      };
    };

    const decorateAssetForResponse = (asset) => {
      if (!asset) return asset;
      const runtime = asset.type === 'mcp' ? mcpRuntime.getCachedRuntime(asset) : null;
      const decorated = asset.type === 'mcp' ? { ...asset, runtime } : { ...asset };
      const health = evaluateAssetHealth(decorated, {
        isLocalEnvironment: decorated.environment_type !== 'remote',
        runtime,
      });
      return attachCapabilities({
        ...decorated,
        health,
      }, {
        projectRoot: decorated.projectPath || projectRoot,
      });
    };

    const decorateAssetList = (assets) => assets.map((asset) => decorateAssetForResponse(asset));
    const readLocalJsonSafe = (filePath) => {
      if (!filePath || !fs.existsSync(filePath)) return {};
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        return {};
      }
    };
    const ensureLocalDir = (targetPath) => fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const removeLocalPath = (targetPath) => {
      if (!targetPath) return;
      try {
        fs.rmSync(targetPath, { force: true });
      } catch {
        try { fs.unlinkSync(targetPath); } catch {}
      }
    };
    const extractMcpEntryFromDocument = (doc, provider, name) => {
      const key = provider === 'continue_dev' ? 'servers' : (doc?.mcpServers ? 'mcpServers' : 'servers');
      return doc?.[key]?.[name] || null;
    };
    const setMcpEntryInDocument = (doc, provider, name, value) => {
      const key = provider === 'continue_dev' ? 'servers' : 'mcpServers';
      const next = { ...(doc || {}) };
      if (!next[key] || typeof next[key] !== 'object') next[key] = {};
      next[key][name] = value;
      return next;
    };
    const isRemoteAsset = (asset) => {
      if (!asset) return false;
      if (asset.environment_type === 'remote') return true;
      const environmentId = asset.environment_id || asset.environmentId || null;
      return environmentId ? getEnvironmentById(environmentId)?.type === 'remote' : false;
    };
    const withRemoteClient = async (environmentId, fn) => {
      const environment = getEnvironmentById(environmentId);
      if (!environment || environment.type !== 'remote') {
        throw new Error('Remote environment not found');
      }
      const client = await remote.sshConnect(environment);
      try {
        return await fn(client, environment);
      } finally {
        remote.sshDisconnect(environment.id);
      }
    };
    const readAssetText = async (asset) => {
      if (!asset?.filePath) return null;
      if (!isRemoteAsset(asset)) {
        if (!fs.existsSync(asset.filePath)) return null;
        return fs.readFileSync(asset.filePath, 'utf-8');
      }
      const environmentId = asset.environment_id || asset.environmentId || null;
      if (!environmentId) return null;
      return withRemoteClient(environmentId, (client) => remote.sshReadFile(client, asset.filePath));
    };
    const readAssetMcpEntry = async (asset) => {
      if (!asset) return null;
      if (asset.rawConfig) return asset.rawConfig;
      if (!asset.filePath) return null;
      const provider = inferProviderFromAsset(asset);
      if (!isRemoteAsset(asset)) {
        const doc = readLocalJsonSafe(asset.filePath);
        return extractMcpEntryFromDocument(doc, provider, asset.name);
      }
      const environmentId = asset.environment_id || asset.environmentId || null;
      if (!environmentId) return null;
      return withRemoteClient(environmentId, async (client) => {
        const raw = await remote.sshReadFile(client, asset.filePath);
        if (!raw) return null;
        try {
          return extractMcpEntryFromDocument(JSON.parse(raw), provider, asset.name);
        } catch {
          return null;
        }
      });
    };
    const buildCurrentTopology = () => buildTopology({
      localAssets: decorateAssetList(getData()),
      storedAssets: decorateAssetList(store.getAssets()),
      environments: store.getEnvironments(),
      projects: store.getProjects(),
      runningAgents: decorateRunningAgentList(store.getRunningAgents ? store.getRunningAgents() : []),
      localEnvironmentId: store.getLocalEnvironmentId(),
    });
    const buildCurrentDependencyGraph = () => buildDependencyGraph(buildCurrentTopology());
    const buildCurrentPolicyEvaluation = async () => policies.evaluatePolicies({
      policies: store.getPolicies ? store.getPolicies() : [],
      projects: store.getProjects(),
      environments: store.getEnvironments(),
      localAssets: decorateAssetList(getData()),
      localEnvironmentId: store.getLocalEnvironmentId(),
      getStoredAssetsByEnvironment: (environmentId) => decorateAssetList(store.getAssets({ environment_id: environmentId })),
      scanProjectAssets,
      remote,
    });
    const buildManifestContext = () => ({
      getAssets: (filters) => decorateAssetList(store.getAssets(filters)),
      getLocalEnvironmentId: () => store.getLocalEnvironmentId(),
      getProjects: () => store.getProjects(),
      scanProjectAssets,
      getBundles: () => store.getBundles ? store.getBundles() : [],
      getPolicies: () => store.getPolicies ? store.getPolicies() : [],
      getProviderStats: () => store.getProviderStats ? store.getProviderStats() : [],
      createBundle: (payload) => store.createBundle ? store.createBundle(payload) : null,
      updateBundle: (bundleId, payload) => store.updateBundle ? store.updateBundle(bundleId, payload) : null,
      createPolicy: (payload) => store.createPolicy ? store.createPolicy(payload) : null,
      updatePolicy: (policyId, payload) => store.updatePolicy ? store.updatePolicy(policyId, payload) : null,
      projectRoot,
    });

    const writeBlockReason = ({ serverIds = [], actionLabel = 'This write action' } = {}) => {
      const auditMode = getAuditMode();
      if (auditMode.global_read_only) {
        return {
          code: 'audit_global_read_only',
          message: `${actionLabel} is blocked while global read-only audit mode is enabled.`,
          auditMode,
        };
      }

      for (const serverId of serverIds.filter(Boolean)) {
        const environment = getEnvironmentById(serverId);
        if (environment?.read_only) {
          return {
            code: 'audit_server_read_only',
            message: `${actionLabel} is blocked because ${environment.name} is in read-only audit mode.`,
            auditMode,
            environmentId: environment.id,
            environmentName: environment.name,
          };
        }
      }

      return null;
    };

    const blockWrite = (reason) => send(423, {
      ok: false,
      error: reason.message,
      code: reason.code,
      auditMode: reason.auditMode,
      environmentId: reason.environmentId || null,
      environmentName: reason.environmentName || null,
    });

    const buildAuditReport = async () => {
      const localAssets = decorateAssetList(getData());
      const stats = store.getStats();
      const projects = store.getProjects();
      const environments = store.getEnvironments();
      const runningAgents = store.getRunningAgents ? store.getRunningAgents() : [];
      const driftGraph = await loadDriftGraph();
      const auditMode = getAuditMode();
      const healthCounts = localAssets.reduce((acc, asset) => {
        if (asset.health?.status === 'broken') acc.broken += 1;
        else if (asset.health?.status === 'warning') acc.warning += 1;
        return acc;
      }, { broken: 0, warning: 0 });
      const driftCounts = driftGraph.groups.reduce((acc, group) => {
        const status = group.status;
        if (status && acc[status] !== undefined) acc[status] += 1;
        return acc;
      }, { source: 0, synced: 0, drifted: 0, orphaned: 0 });

      return {
        generated_at: new Date().toISOString(),
        audit_mode: auditMode,
        summary: {
          asset_count: stats.total,
          project_count: projects.length,
          local_project_count: projects.filter((project) => project.environment_type !== 'remote').length,
          remote_project_count: projects.filter((project) => project.environment_type === 'remote').length,
          environment_count: environments.length,
          remote_server_count: environments.filter((environment) => environment.type === 'remote').length,
          running_agent_count: runningAgents.length,
          broken_asset_count: healthCounts.broken,
          warning_asset_count: healthCounts.warning,
          drift_group_count: driftGraph.summary.groupCount,
          drifted_group_count: driftCounts.drifted,
          orphaned_group_count: driftCounts.orphaned,
        },
        blocked_actions: [
          'create',
          'edit',
          'delete',
          'connect',
          'disconnect',
          'sync apply',
          'rollback',
        ],
        providers: store.getProviderStats(),
        environments: environments.map((environment) => ({
          id: environment.id,
          name: environment.name,
          type: environment.type,
          read_only: Number(environment.read_only || 0) === 1,
          ssh_host: environment.ssh_host || null,
          ssh_user: environment.ssh_user || null,
          project_count: projects.filter((project) => project.environment_id === environment.id).length,
          asset_count: store.getAssets({ environment_id: environment.id }).length,
        })),
        top_issues: localAssets
          .filter((asset) => asset.health?.status && asset.health.status !== 'ok')
          .slice(0, 25)
          .map((asset) => ({
            id: asset.id,
            name: asset.name,
            type: asset.type,
            status: asset.health.status,
            summary: asset.health.summary,
          })),
      };
    };

    const beginWriteSnapshot = (config) => snapshots.beginSnapshot(config, { getEnvironmentById });
    const finalizeWriteSnapshot = (session) => snapshots.finalizeSnapshot(session, { getEnvironmentById });

    const listMcpPaths = (source) => [
      ...new Set([
        ...Object.values(source?.locations || {}).filter(Boolean),
        ...(source?.filePath ? [source.filePath] : []),
      ]),
    ];

    const buildDeleteDescriptors = (source) => {
      if (!source) return [];
      if (source.type === 'mcp') {
        return listMcpPaths(source).map((targetPath) => ({ transport: 'local', targetPath }));
      }
      return source.filePath ? [{ transport: 'local', targetPath: source.filePath }] : [];
    };

    const buildConnectDescriptors = (source, tool) => {
      if (!source || !tool) return [];
      if (source.type === 'mcp') {
        const targetPath = getMcpConfigPath(tool, projectRoot);
        return targetPath ? [{ transport: 'local', targetPath }] : [];
      }
      const targetPath = getTargetPath(tool, source.type, source.name, projectRoot);
      return targetPath ? [{ transport: 'local', targetPath }] : [];
    };

    const buildSyncDescriptors = (plan) => (plan?.operations || [])
      .filter((operation) => operation.action !== 'noop' && operation.targetPath)
      .map((operation) => ({
        transport: operation.mode.startsWith('remote-') ? 'remote' : 'local',
        environmentId: operation.mode.startsWith('remote-') ? plan?.target?.serverId || null : null,
        targetPath: operation.targetPath,
      }));
    const buildApprovalRequirementForSyncPlan = (plan) => {
      const operations = plan?.operations || [];
      const writesRemote = plan?.target?.kind === 'server'
        || operations.some((operation) => typeof operation.mode === 'string' && operation.mode.startsWith('remote-'));
      if (writesRemote) {
        return { required: true, reason: 'This sync writes to a remote environment.' };
      }
      if (operations.some((operation) => operation.action === 'update')) {
        return { required: true, reason: 'This sync overwrites existing target content.' };
      }
      if (operations.length > 1) {
        return { required: true, reason: 'This sync changes multiple target locations.' };
      }
      return { required: false, reason: null };
    };
    const buildApprovalRequirementForBatchSync = (preview) => {
      if (!preview) return { required: false, reason: null };
      if (preview.results.some((entry) => entry.ok && buildApprovalRequirementForSyncPlan(entry.plan).required)) {
        return {
          required: true,
          reason: 'This batch sync includes remote writes, overwrites, or multiple target changes.',
        };
      }
      if ((preview.operationCount || 0) > 3) {
        return {
          required: true,
          reason: 'This batch sync changes several targets at once.',
        };
      }
      return { required: false, reason: null };
    };
    const buildApprovalRequirementForSnapshotRollback = (snapshot) => {
      const entries = snapshot?.entries || [];
      if (entries.some((entry) => entry.environmentId)) {
        return {
          required: true,
          reason: 'This rollback restores changes on a remote environment.',
        };
      }
      if (entries.length > 1) {
        return {
          required: true,
          reason: 'This rollback restores multiple files at once.',
        };
      }
      return { required: false, reason: null };
    };

    const refreshRemoteEnvironment = async (environmentId) => {
      const env = getEnvironmentById(environmentId);
      if (!env || env.type !== 'remote') return;
      const assets = await remote.scanRemote(env);
      const { categorize } = require('./categorizer');
      const categorized = categorize({
        skills: assets.filter((asset) => asset.type === 'skill'),
        agents: assets.filter((asset) => asset.type === 'agent'),
        mcpServers: assets.filter((asset) => asset.type === 'mcp'),
        instructions: assets.filter((asset) => asset.type === 'instruction'),
        rules: assets.filter((asset) => asset.type === 'rule'),
      });
      store.upsertAssets(categorized, env.id);
    };
    const collectLocalCandidateAssets = () => {
      const localAssets = decorateAssetList(getData());
      const localProjects = store.getProjects().filter((project) => project.environment_type !== 'remote');
      const seen = new Set(localAssets.map((asset) => asset.id));
      const combined = [...localAssets];
      for (const project of localProjects) {
        const assets = scanProjectAssets(project.path, {
          environmentId: project.environment_id || store.getLocalEnvironmentId(),
          environmentType: 'local',
        });
        for (const asset of decorateAssetList(assets)) {
          if (seen.has(asset.id)) continue;
          seen.add(asset.id);
          combined.push(asset);
        }
      }
      return combined;
    };
    const previewSyncRequest = (request) => sync.previewSync(request, {
      resolveAsset,
      getEnvironmentById,
      getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
      projectRoot,
      dependencyGraph: buildCurrentDependencyGraph(),
    });
    const applySyncRequest = async (request, meta) => {
      const previewPlan = await sync.previewSync(request, {
        resolveAsset,
        getEnvironmentById,
        getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
        projectRoot,
        dependencyGraph: buildCurrentDependencyGraph(),
      });
      if (!previewPlan.canApply || !previewPlan.hasChanges) {
        return { ok: false, error: 'Remediation plan is not applicable', plan: previewPlan };
      }
      const approvalRequirement = buildApprovalRequirementForSyncPlan(previewPlan);
      const approval = requireApproval({
        required: meta.requireApproval || approvalRequirement.required,
        approval: meta.approval,
        reason: meta.approvalReason || approvalRequirement.reason,
      });
      if (approval?.ok === false) return approval;
      const snapshotSession = await beginWriteSnapshot({
        action: 'remediation',
        label: meta.title || `Remediation for ${previewPlan.source?.name || request.source?.name || 'asset'}`,
        entries: buildSyncDescriptors(previewPlan),
        metadata: {
          remediationId: meta.remediationId,
          subjectKind: meta.subjectKind,
          subjectId: meta.subjectId,
          target: previewPlan.target || request.target,
        },
      });
      const result = await sync.applySync(request, {
        resolveAsset,
        getEnvironmentById,
        getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
        projectRoot,
        dependencyGraph: buildCurrentDependencyGraph(),
      });
      if (!result.ok) return result;
      const snapshot = await finalizeWriteSnapshot(snapshotSession);
      if (request.target.kind === 'server' && request.target.serverId) {
        await refreshRemoteEnvironment(request.target.serverId);
      }
      recordHistoryAction('remediation', previewPlan.source?.name || request.source?.name || 'asset', {
        remediationId: meta.remediationId,
        subjectKind: meta.subjectKind,
        subjectId: meta.subjectId,
        target: previewPlan.target || request.target,
        approval,
        approvalRequired: meta.requireApproval || approvalRequirement.required,
        approvalReason: meta.approvalReason || approvalRequirement.reason,
        snapshotId: snapshot?.id || null,
      });
      rescan();
      return { ...result, snapshot };
    };
    const applyAssetRepairFromSource = async (asset, sourceAsset, suggestion) => {
      if (!asset?.filePath) {
        throw new Error('Target asset has no file path');
      }
      if (!sourceAsset) {
        throw new Error('Source asset not found');
      }

      if (asset.type === 'mcp') {
        const entryValue = await readAssetMcpEntry(sourceAsset);
        if (!entryValue) throw new Error('Source MCP config entry not found');
        if (!isRemoteAsset(asset)) {
          const currentDoc = readLocalJsonSafe(asset.filePath);
          const nextDoc = setMcpEntryInDocument(currentDoc, inferProviderFromAsset(asset), asset.name, entryValue);
          ensureLocalDir(asset.filePath);
          fs.writeFileSync(asset.filePath, JSON.stringify(nextDoc, null, 2), 'utf-8');
        } else {
          const environmentId = asset.environment_id || asset.environmentId || null;
          if (!environmentId) throw new Error('Remote environment not found');
          await withRemoteClient(environmentId, async (client) => {
            const raw = await remote.sshReadFile(client, asset.filePath);
            let currentDoc = {};
            try { currentDoc = raw ? JSON.parse(raw) : {}; } catch { currentDoc = {}; }
            const nextDoc = setMcpEntryInDocument(currentDoc, inferProviderFromAsset(asset), asset.name, entryValue);
            await remote.sshWriteFile(client, asset.filePath, JSON.stringify(nextDoc, null, 2));
          });
        }
      } else {
        const sourceContent = await readAssetText(sourceAsset);
        if (sourceContent === null || sourceContent === undefined) {
          throw new Error('Source asset file is missing');
        }
        const issueCodes = new Set(suggestion?.issueCodes || []);
        if (!isRemoteAsset(asset)) {
          ensureLocalDir(asset.filePath);
          removeLocalPath(asset.filePath);
          const canRecreateSymlink = issueCodes.has('broken_symlink') && !isRemoteAsset(sourceAsset) && sourceAsset.filePath;
          if (canRecreateSymlink) {
            try {
              fs.symlinkSync(path.resolve(sourceAsset.filePath), asset.filePath);
            } catch {
              fs.writeFileSync(asset.filePath, sourceContent, 'utf-8');
            }
          } else {
            fs.writeFileSync(asset.filePath, sourceContent, 'utf-8');
          }
        } else {
          const environmentId = asset.environment_id || asset.environmentId || null;
          if (!environmentId) throw new Error('Remote environment not found');
          await withRemoteClient(environmentId, (client) => remote.sshWriteFile(client, asset.filePath, sourceContent));
        }
      }

      const targetEnvironmentId = asset.environment_id || asset.environmentId || null;
      if (targetEnvironmentId && getEnvironmentById(targetEnvironmentId)?.type === 'remote') {
        await refreshRemoteEnvironment(targetEnvironmentId);
      }
    };

    const resolveCreatePath = (body) => {
      const HOME = process.env.HOME || '';
      const {
        name,
        type,
        provider = 'claude',
        scope = 'global',
      } = body;
      const isProject = scope === 'project';
      const projectBase = projectRoot || process.cwd();

      if (type === 'skill') {
        if (isProject) return path.join(projectBase, '.claude', 'commands', `${name}.md`);
        if (provider === 'codex') return path.join(HOME, '.codex', 'skills', 'public', `${name}.md`);
        if (provider === 'gemini') return path.join(HOME, '.gemini', 'skills', `${name}.md`);
        return path.join(claudeDir, 'commands', `${name}.md`);
      }

      if (type === 'agent') {
        if (isProject) return path.join(projectBase, '.claude', 'agents', `${name}.md`);
        if (provider === 'codex') return path.join(HOME, '.codex', 'agents', `${name}.md`);
        return path.join(claudeDir, 'agents', `${name}.md`);
      }

      if (type === 'rule') {
        if (provider === 'cursor') return path.join(projectBase, '.cursor', 'rules', `${name}.md`);
        if (provider === 'windsurf') return path.join(projectBase, '.windsurf', 'rules', `${name}.md`);
        if (provider === 'claude') return path.join(isProject ? projectBase : claudeDir, 'rules', `${name}.md`);
        return null;
      }

      if (type === 'instruction') {
        return resolveInstructionPath(provider, scope);
      }

      return null;
    };

    // GET /api/assets — list all (with filters)
    if (url.pathname === '/api/assets' && req.method === 'GET') {
      let assets = decorateAssetList(getData());
      const type = url.searchParams.get('type');
      const provider = url.searchParams.get('provider');
      const category = url.searchParams.get('category');
      const search = url.searchParams.get('q');

      if (type) {
        const types = type.split(',');
        assets = assets.filter(a => types.includes(a.type));
      }
      if (provider) assets = assets.filter(a => (a.providers || []).includes(provider));
      if (category) assets = assets.filter(a => a.cat === category);
      if (search) {
        const q = search.toLowerCase();
        assets = assets.filter(a => {
          const text = `${a.name} ${a.desc} ${(a.tags || []).join(' ')} ${a.keywords || ''}`.toLowerCase();
          return text.includes(q);
        });
      }

      return send(200, { ok: true, data: assets, total: assets.length });
    }

    // GET /api/assets/:id/connections
    if (url.pathname.match(/^\/api\/assets\/(.+)\/connections$/) && req.method === 'GET') {
      const assetRef = decodeURIComponent(url.pathname.split('/')[3]);
      const type = url.searchParams.get('type') || 'skill';
      const source = resolveAsset(assetRef, type);
      const connections = getConnections(
        source ? source.filePath : null,
        source ? source.type : type,
        source ? source.name : assetRef,
        projectRoot,
        source ? source.locations : null
      );
      return send(200, connections);
    }

    // ─── CRUD: Read / Update / Create / Delete ─────────

    // GET /api/assets/:name/content — read file content
    if (url.pathname.match(/^\/api\/assets\/(.+)\/content$/) && req.method === 'GET') {
      const assetRef = decodeURIComponent(url.pathname.split('/')[3]);
      const source = resolveAsset(assetRef, url.searchParams.get('type'));
      if (!source || !source.filePath) return send(404, { ok: false, error: 'Asset not found or no file' });
      try {
        if (source.type === 'mcp') {
          return send(200, {
            ok: true,
            content: JSON.stringify(source.rawConfig || {}, null, 2),
            filePath: source.filePath,
          });
        }
        const content = fs.readFileSync(source.filePath, 'utf-8');
        return send(200, { ok: true, content, filePath: source.filePath });
      } catch (err) {
        return send(500, { ok: false, error: 'Cannot read file: ' + err.message });
      }
    }

    // PUT /api/assets/:name/content — update file content
    if (url.pathname.match(/^\/api\/assets\/(.+)\/content$/) && req.method === 'PUT') {
      const assetRef = decodeURIComponent(url.pathname.split('/')[3]);
      return readBody().then(async (body) => {
        const blocked = writeBlockReason({ actionLabel: 'Editing asset content' });
        if (blocked) return blockWrite(blocked);
        if (!body || typeof body.content !== 'string') return send(400, { ok: false, error: 'Provide content string' });
        const source = resolveAsset(assetRef, body.type || url.searchParams.get('type'));
        if (!source || !source.filePath) return send(404, { ok: false, error: 'Asset not found or no file' });
        try {
          const snapshotSession = await beginWriteSnapshot({
            action: 'edit',
            label: `Edit ${source.type} ${source.name}`,
            entries: [{ transport: 'local', targetPath: source.filePath }],
          });
          if (source.type === 'mcp') {
            const nextConfig = JSON.parse(body.content);
            const raw = fs.existsSync(source.filePath) ? JSON.parse(fs.readFileSync(source.filePath, 'utf-8')) : {};
            const key = raw.mcpServers ? 'mcpServers' : (raw.servers ? 'servers' : 'mcpServers');
            if (!raw[key]) raw[key] = {};
            raw[key][source.name] = nextConfig;
            fs.writeFileSync(source.filePath, JSON.stringify(raw, null, 2), 'utf-8');
            const snapshot = await finalizeWriteSnapshot(snapshotSession);
            recordHistoryAction('edit', source.name, { filePath: source.filePath, type: source.type, snapshotId: snapshot?.id || null });
            return send(200, { ok: true });
          }
          fs.writeFileSync(source.filePath, body.content, 'utf-8');
          const snapshot = await finalizeWriteSnapshot(snapshotSession);
          recordHistoryAction('edit', source.name, { filePath: source.filePath, type: source.type, snapshotId: snapshot?.id || null });
          // Watcher will trigger rescan automatically
          return send(200, { ok: true });
        } catch (err) {
          return send(500, { ok: false, error: 'Cannot write file: ' + err.message });
        }
      });
    }

    // POST /api/assets/create — create new asset file
    if (url.pathname === '/api/assets/create' && req.method === 'POST') {
      return readBody().then(async (body) => {
        const blocked = writeBlockReason({ actionLabel: 'Creating assets' });
        if (blocked) return blockWrite(blocked);
        if (!body || !body.name || !body.type) return send(400, { ok: false, error: 'Provide name and type' });
        const { name, type, content, provider, scope } = body;
        const HOME = process.env.HOME || '';

        if (type === 'mcp') {
          let mcpPath;
          if (provider === 'codex') mcpPath = path.join(HOME, '.codex', 'mcp.json');
          else if (provider === 'gemini') mcpPath = path.join(HOME, '.gemini', 'mcp.json');
          else if (provider === 'windsurf') mcpPath = path.join(HOME, '.windsurf', 'mcp.json');
          else if (provider === 'continue_dev') mcpPath = path.join(HOME, '.continue', 'config.json');
          else mcpPath = scope === 'project' ? path.join(projectRoot || process.cwd(), '.mcp.json') : path.join(claudeDir, '.mcp.json');

          let config = body.config;
          if (!config && typeof content === 'string' && content.trim()) {
            try {
              config = JSON.parse(content);
            } catch {
              return send(400, { ok: false, error: 'MCP config must be valid JSON' });
            }
          }
          if (!config || typeof config !== 'object' || Array.isArray(config)) {
            return send(400, { ok: false, error: 'Provide MCP config JSON with at least command or url' });
          }
          if (!config.command && !config.url && !config.type) {
            return send(400, { ok: false, error: 'MCP config must include command or url' });
          }

          try {
            const snapshotSession = await beginWriteSnapshot({
              action: 'create',
              label: `Create MCP ${name}`,
              entries: [{ transport: 'local', targetPath: mcpPath }],
            });
            const raw = fs.existsSync(mcpPath) ? JSON.parse(fs.readFileSync(mcpPath, 'utf-8')) : {};
            const key = provider === 'continue_dev' ? 'servers' : 'mcpServers';
            if (!raw[key]) raw[key] = {};
            if (raw[key][name]) return send(409, { ok: false, error: 'MCP server already exists' });
            raw[key][name] = config;
            const dir = path.dirname(mcpPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(mcpPath, JSON.stringify(raw, null, 2), 'utf-8');
            const snapshot = await finalizeWriteSnapshot(snapshotSession);
            recordHistoryAction('create', name, { type: 'mcp', provider, filePath: mcpPath, snapshotId: snapshot?.id || null });
            return send(200, { ok: true, filePath: mcpPath });
          } catch (err) {
            return send(500, { ok: false, error: err.message });
          }
        }

        const filePath = resolveCreatePath(body);
        if (!filePath) {
          return send(400, { ok: false, error: 'Unknown type: ' + type });
        }

        // Write the file
        try {
          const snapshotSession = await beginWriteSnapshot({
            action: 'create',
            label: `Create ${type} ${name}`,
            entries: [{ transport: 'local', targetPath: filePath }],
          });
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          if (fs.existsSync(filePath)) return send(409, { ok: false, error: 'File already exists' });
          fs.writeFileSync(filePath, content || defaultContent(name, type), 'utf-8');
          const snapshot = await finalizeWriteSnapshot(snapshotSession);
          recordHistoryAction('create', name, { type, provider, scope, filePath, snapshotId: snapshot?.id || null });
          return send(200, { ok: true, filePath });
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // POST /api/generate — AI-generate asset content
    if (url.pathname === '/api/generate' && req.method === 'POST') {
      return readBody().then(body => {
        if (!body || !body.description || !body.type) {
          return send(400, { ok: false, error: 'Provide description and type' });
        }
        return generateAssetContent(body.type, body.name || 'untitled', body.description)
          .then(content => send(200, { ok: true, content }))
          .catch(err => send(500, { ok: false, error: err.message }));
      });
    }

    // DELETE /api/assets/:name — delete asset
    if (url.pathname.match(/^\/api\/assets\/([^/]+)$/) && req.method === 'DELETE') {
      return (async () => {
        const blocked = writeBlockReason({ actionLabel: 'Deleting assets' });
        if (blocked) return blockWrite(blocked);
        const assetRef = decodeURIComponent(url.pathname.split('/')[3]);
        const type = url.searchParams.get('type');
        const source = resolveAsset(assetRef, type);

        if (type === 'mcp') {
          const mcpPaths = listMcpPaths(source);
          let removed = false;
          for (const mcpPath of mcpPaths) {
            if (!fs.existsSync(mcpPath)) continue;
            try {
              const snapshotSession = await beginWriteSnapshot({
                action: 'delete',
                label: `Delete MCP ${source.name}`,
                entries: [{ transport: 'local', targetPath: mcpPath }],
              });
              const raw = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
              const servers = raw.mcpServers || raw.servers || {};
              if (servers[source.name]) {
                delete servers[source.name];
                fs.writeFileSync(mcpPath, JSON.stringify(raw, null, 2), 'utf-8');
                const snapshot = await finalizeWriteSnapshot(snapshotSession);
                recordHistoryAction('delete', source.name, { type: 'mcp', filePath: mcpPath, snapshotId: snapshot?.id || null });
                removed = true;
              }
            } catch {
              // Skip broken config locations and keep scanning the rest.
            }
          }
          if (removed) {
            return send(200, { ok: true });
          }
          return send(404, { ok: false, error: 'MCP server not found in configs' });
        }

        if (!source || !source.filePath) return send(404, { ok: false, error: 'Asset not found' });
        try {
          const snapshotSession = await beginWriteSnapshot({
            action: 'delete',
            label: `Delete ${type || source.type} ${source.name}`,
            entries: [{ transport: 'local', targetPath: source.filePath }],
          });
          fs.unlinkSync(source.filePath);
          const snapshot = await finalizeWriteSnapshot(snapshotSession);
          recordHistoryAction('delete', source.name, {
            type: type || source.type || 'unknown',
            filePath: source.filePath,
            snapshotId: snapshot?.id || null,
          });
          return send(200, { ok: true });
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      })();
    }

    // POST /api/connect
    if (url.pathname === '/api/connect' && req.method === 'POST') {
      return readBody().then(async (body) => {
        const blocked = writeBlockReason({ actionLabel: 'Connecting assets' });
        if (blocked) return blockWrite(blocked);
        if (!body) return send(400, { ok: false, error: 'Invalid JSON' });
        const { assetId, name, tool, type } = body;
        const source = resolveAsset(assetId || name, type);
        if (!source) return send(404, { ok: false, error: 'Asset not found' });
        const snapshotSession = await beginWriteSnapshot({
          action: 'connect',
          label: `Connect ${source.type} ${source.name} to ${tool}`,
          entries: buildConnectDescriptors(source, tool),
        });
        const result = connect(source.filePath, tool, source.type, source.name, projectRoot, source.rawConfig);
        if (result.ok) {
          const snapshot = await finalizeWriteSnapshot(snapshotSession);
          recordHistoryAction('connect', source.name, {
            tool,
            type: source.type,
            method: result.method,
            targetPath: result.targetPath || null,
            snapshotId: snapshot?.id || null,
          });
        }
        return send(result.ok ? 200 : 400, result);
      });
    }

    // POST /api/disconnect
    if (url.pathname === '/api/disconnect' && req.method === 'POST') {
      return readBody().then(async (body) => {
        const blocked = writeBlockReason({ actionLabel: 'Disconnecting assets' });
        if (blocked) return blockWrite(blocked);
        if (!body) return send(400, { ok: false, error: 'Invalid JSON' });
        const { assetId, name, tool, type } = body;
        const source = resolveAsset(assetId || name, type);
        if (!source) return send(404, { ok: false, error: 'Asset not found' });
        const snapshotSession = await beginWriteSnapshot({
          action: 'disconnect',
          label: `Disconnect ${source.type} ${source.name} from ${tool}`,
          entries: buildConnectDescriptors(source, tool),
        });
        const result = disconnect(tool, source.type, source.name, projectRoot);
        if (result.ok) {
          const snapshot = await finalizeWriteSnapshot(snapshotSession);
          recordHistoryAction('disconnect', source.name, {
            tool,
            type: source.type,
            targetPath: getTargetPath(tool, source.type, source.name, projectRoot),
            snapshotId: snapshot?.id || null,
          });
        }
        return send(result.ok ? 200 : 400, result);
      });
    }

    // POST /api/batch/validate
    if (url.pathname === '/api/batch/validate' && req.method === 'POST') {
      return readBody().then((body) => {
        const result = batch.validateBatch(body, { resolveAsset, projectRoot });
        return send(200, result);
      });
    }

    // POST /api/batch/connect
    if (url.pathname === '/api/batch/connect' && req.method === 'POST') {
      return readBody().then(async (body) => {
        const blocked = writeBlockReason({ actionLabel: 'Batch connect' });
        if (blocked) return blockWrite(blocked);
        const items = Array.isArray(body?.items) ? body.items : [];
        const tool = body?.tool;
        const descriptors = items.flatMap((item) => buildConnectDescriptors(resolveAsset(item.assetId || item.name, item.type), tool));
        const snapshotSession = await beginWriteSnapshot({
          action: 'batch-connect',
          label: `Batch connect ${items.length} assets to ${tool}`,
          entries: descriptors,
          metadata: { total: items.length, tool },
        });
        const result = batch.connectBatch(body, { resolveAsset, projectRoot });
        let snapshot = null;
        if (result.successCount > 0) {
          snapshot = await finalizeWriteSnapshot(snapshotSession);
        }
        for (const entry of result.results.filter((item) => item.ok)) {
          recordHistoryAction('connect', entry.name, {
            tool,
            type: entry.type,
            batch: true,
            snapshotId: snapshot?.id || null,
          });
        }
        if (result.successCount > 0) rescan();
        return send(200, result);
      });
    }

    // POST /api/batch/disconnect
    if (url.pathname === '/api/batch/disconnect' && req.method === 'POST') {
      return readBody().then(async (body) => {
        const blocked = writeBlockReason({ actionLabel: 'Batch disconnect' });
        if (blocked) return blockWrite(blocked);
        const items = Array.isArray(body?.items) ? body.items : [];
        const tool = body?.tool;
        const descriptors = items.flatMap((item) => buildConnectDescriptors(resolveAsset(item.assetId || item.name, item.type), tool));
        const snapshotSession = await beginWriteSnapshot({
          action: 'batch-disconnect',
          label: `Batch disconnect ${items.length} assets from ${tool}`,
          entries: descriptors,
          metadata: { total: items.length, tool },
        });
        const result = batch.disconnectBatch(body, { resolveAsset, projectRoot });
        let snapshot = null;
        if (result.successCount > 0) {
          snapshot = await finalizeWriteSnapshot(snapshotSession);
        }
        for (const entry of result.results.filter((item) => item.ok)) {
          recordHistoryAction('disconnect', entry.name, {
            tool,
            type: entry.type,
            batch: true,
            snapshotId: snapshot?.id || null,
          });
        }
        if (result.successCount > 0) rescan();
        return send(200, result);
      });
    }

    // POST /api/batch/delete
    if (url.pathname === '/api/batch/delete' && req.method === 'POST') {
      return readBody().then(async (body) => {
        const blocked = writeBlockReason({ actionLabel: 'Batch delete' });
        if (blocked) return blockWrite(blocked);
        const items = Array.isArray(body?.items) ? body.items : [];
        const approval = requireApproval({
          required: items.length > 0,
          approval: body?.approval,
          reason: 'Batch delete removes harness assets from disk.',
        });
        if (approval?.ok === false) {
          return send(409, approval);
        }
        const descriptors = items.flatMap((item) => buildDeleteDescriptors(resolveAsset(item.assetId || item.name, item.type)));
        const snapshotSession = await beginWriteSnapshot({
          action: 'batch-delete',
          label: `Batch delete ${items.length} assets`,
          entries: descriptors,
          metadata: {
            total: items.length,
            approval,
            approvalRequired: items.length > 0,
            approvalReason: 'Batch delete removes harness assets from disk.',
          },
        });
        const result = batch.deleteBatch(body, { resolveAsset, projectRoot });
        let snapshot = null;
        if (result.successCount > 0) {
          snapshot = await finalizeWriteSnapshot(snapshotSession);
        }
        for (const entry of result.results.filter((item) => item.ok)) {
          recordHistoryAction('delete', entry.name, {
            type: entry.type,
            filePath: entry.filePath,
            batch: true,
            total: items.length,
            approval,
            approvalRequired: items.length > 0,
            approvalReason: 'Batch delete removes harness assets from disk.',
            snapshotId: snapshot?.id || null,
          });
        }
        if (result.successCount > 0) rescan();
        return send(200, result);
      });
    }

    // GET /api/connections (legacy compat)
    if (url.pathname === '/api/connections' && req.method === 'GET') {
      const name = url.searchParams.get('name');
      const assetId = url.searchParams.get('assetId');
      const type = url.searchParams.get('type') || 'skill';
      const source = resolveAsset(assetId || name, type);
      const connections = getConnections(
        source ? source.filePath : null,
        source ? source.type : type,
        source ? source.name : name,
        projectRoot,
        source ? source.locations : null
      );
      return send(200, connections);
    }

    // GET /api/audit-mode
    if (url.pathname === '/api/audit-mode' && req.method === 'GET') {
      return send(200, { ok: true, data: getAuditMode() });
    }

    // POST /api/audit-mode/global
    if (url.pathname === '/api/audit-mode/global' && req.method === 'POST') {
      return readBody().then((body) => {
        if (typeof body?.readOnly !== 'boolean') {
          return send(400, { ok: false, error: 'readOnly boolean is required' });
        }
        store.setGlobalReadOnly(body.readOnly);
        return send(200, { ok: true, data: getAuditMode() });
      });
    }

    // GET /api/audit/report
    if (url.pathname === '/api/audit/report' && req.method === 'GET') {
      return buildAuditReport()
        .then((report) => send(200, { ok: true, data: report }))
        .catch((err) => send(500, { ok: false, error: err.message }));
    }

    // GET /api/providers — from store
    if (url.pathname === '/api/providers' && req.method === 'GET') {
      return send(200, { ok: true, data: store.getProviderStats() });
    }

    // GET /api/categories — from store
    if (url.pathname === '/api/categories' && req.method === 'GET') {
      const cats = {};
      for (const row of store.getCategories()) cats[row.category] = row.count;
      return send(200, { ok: true, data: cats });
    }

    // GET /api/stats — summary stats
    if (url.pathname === '/api/stats' && req.method === 'GET') {
      return send(200, { ok: true, data: store.getStats() });
    }

    // GET /api/topology — canonical graph across environments, projects, providers, agents and assets
    if (url.pathname === '/api/topology' && req.method === 'GET') {
      const topology = buildCurrentTopology();
      return send(200, { ok: true, data: topology });
    }

    // GET /api/dependencies — canonical dependency graph and orphan detection
    if (url.pathname === '/api/dependencies' && req.method === 'GET') {
      return send(200, { ok: true, data: buildCurrentDependencyGraph() });
    }

    // GET /api/assets/:id/dependencies — dependency detail for a single asset
    if (url.pathname.match(/^\/api\/assets\/([^/]+)\/dependencies$/) && req.method === 'GET') {
      const assetId = decodeURIComponent(url.pathname.split('/')[3]);
      const graph = buildCurrentDependencyGraph();
      const data = graph.byAssetId[assetId];
      if (!data) return send(404, { ok: false, error: 'Dependency data not found' });
      return send(200, { ok: true, data });
    }

    // GET /api/drift — source-of-truth and divergence map across local/project/remote copies
    if (url.pathname === '/api/drift' && req.method === 'GET') {
      return loadDriftGraph()
        .then((drift) => send(200, { ok: true, data: drift }))
        .catch((err) => send(500, { ok: false, error: err.message }));
    }

    // POST /api/drift/source-truth — assign an explicit source-of-truth copy
    if (url.pathname === '/api/drift/source-truth' && req.method === 'POST') {
      const blocked = writeBlockReason({ actionLabel: 'Updating source of truth' });
      if (blocked) return blockWrite(blocked);
      return readBody().then(async (body) => {
        if (!body?.groupKey || !body?.assetId) {
          return send(400, { ok: false, error: 'groupKey and assetId are required' });
        }
        try {
          const drift = await loadDriftGraph();
          const group = drift.groups.find((entry) => entry.key === body.groupKey);
          if (!group) {
            return send(404, { ok: false, error: 'Drift group not found' });
          }
          if (!group.members.some((member) => member.assetId === body.assetId)) {
            return send(400, { ok: false, error: 'Asset does not belong to the selected drift group' });
          }

          store.setSourceOfTruth(body.groupKey, body.assetId);

          const refreshed = await loadDriftGraph();
          const nextGroup = refreshed.groups.find((entry) => entry.key === body.groupKey) || null;
          const asset = nextGroup?.members.find((member) => member.assetId === body.assetId) || null;

          recordHistoryAction('source-of-truth', asset?.name || body.assetId, {
            groupKey: body.groupKey,
            assetId: body.assetId,
          });

          return send(200, {
            ok: true,
            groupKey: body.groupKey,
            assetId: body.assetId,
            data: nextGroup,
          });
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // GET /api/assets/:id/remediations — suggested fixes for a single asset
    if (url.pathname.match(/^\/api\/assets\/([^/]+)\/remediations$/) && req.method === 'GET') {
      const assetId = decodeURIComponent(url.pathname.split('/')[3]);
      const type = url.searchParams.get('type') || null;
      return resolveAnyAsset(assetId, type)
        .then(async (asset) => {
          if (!asset) return send(404, { ok: false, error: 'Asset not found' });
          const driftGraph = await loadDriftGraph();
          const suggestions = await remediation.buildAssetRemediations(asset, {
            driftGraph,
            resolveAssetById: resolveAnyAsset,
            previewSyncRequest,
          });
          return send(200, { ok: true, data: suggestions });
        })
        .catch((err) => send(500, { ok: false, error: err.message }));
    }

    // POST /api/assets/:id/remediations/:remediationId/apply — apply a suggested asset fix
    if (url.pathname.match(/^\/api\/assets\/([^/]+)\/remediations\/([^/]+)\/apply$/) && req.method === 'POST') {
      const [, , , rawAssetId, , rawRemediationId] = url.pathname.split('/');
      const assetId = decodeURIComponent(rawAssetId);
      const remediationId = decodeURIComponent(rawRemediationId);
      return readBody().then(async (body) => {
        const type = body?.type || url.searchParams.get('type') || null;
        const asset = await resolveAnyAsset(assetId, type);
        if (!asset) return send(404, { ok: false, error: 'Asset not found' });

        const blocked = writeBlockReason({
          actionLabel: 'Asset remediation',
          serverIds: isRemoteAsset(asset) ? [asset.environment_id || asset.environmentId].filter(Boolean) : [],
        });
        if (blocked) return blockWrite(blocked);

        const suggestions = await remediation.buildAssetRemediations(asset, {
          driftGraph: await loadDriftGraph(),
          resolveAssetById: resolveAnyAsset,
          previewSyncRequest,
        });
        const suggestion = suggestions.find((entry) => entry.id === remediationId);
        if (!suggestion) return send(404, { ok: false, error: 'Remediation not found' });
        if (!suggestion.canApply) return send(400, { ok: false, error: 'This remediation is guidance-only' });
        if (suggestion.risky && !body?.confirmRisk) {
          return send(409, { ok: false, error: 'Remediation requires confirmation because it will overwrite drifted content.' });
        }

        try {
          if (suggestion.action === 'runtime_check') {
            const runtime = await mcpRuntime.checkMcpRuntime(asset, { force: true });
            recordHistoryAction('remediation', asset.name, {
              remediationId: suggestion.id,
              action: suggestion.action,
              status: runtime.status,
              approval: normalizeApproval(body?.approval, { required: false }),
            });
            return send(200, { ok: runtime.status === 'ok', data: runtime });
          }

          if (suggestion.action === 'promote_source_of_truth') {
            const driftInfo = asset.drift;
            if (!driftInfo?.groupKey) {
              return send(400, { ok: false, error: 'Asset is not part of a drift group' });
            }
            store.setSourceOfTruth(driftInfo.groupKey, asset.id);
            recordHistoryAction('remediation', asset.name, {
              remediationId: suggestion.id,
              action: suggestion.action,
              groupKey: driftInfo.groupKey,
              approval: normalizeApproval(body?.approval, { required: false }),
            });
            const refreshed = await loadDriftGraph();
            const nextGroup = refreshed.groups.find((entry) => entry.key === driftInfo.groupKey) || null;
            return send(200, { ok: true, data: nextGroup });
          }

          if (suggestion.action === 'repair_from_source') {
            const sourceAsset = await resolveAnyAsset(suggestion.sourceAssetId, asset.type);
            const snapshotSession = await beginWriteSnapshot({
              action: 'remediation',
              label: suggestion.title,
              entries: [{
                transport: isRemoteAsset(asset) ? 'remote' : 'local',
                environmentId: isRemoteAsset(asset) ? (asset.environment_id || asset.environmentId || null) : null,
                targetPath: asset.filePath,
              }],
              metadata: {
                remediationId: suggestion.id,
                sourceAssetId: suggestion.sourceAssetId,
                assetId: asset.id,
              },
            });
            await applyAssetRepairFromSource(asset, sourceAsset, suggestion);
            const snapshot = await finalizeWriteSnapshot(snapshotSession);
            recordHistoryAction('remediation', asset.name, {
              remediationId: suggestion.id,
              action: suggestion.action,
              sourceAssetId: suggestion.sourceAssetId,
              approval: normalizeApproval(body?.approval || (body?.confirmRisk ? { confirmed: true } : null), {
                required: suggestion.risky,
                reason: suggestion.risky ? 'This remediation overwrites current asset content.' : null,
              }),
              approvalRequired: suggestion.risky,
              approvalReason: suggestion.risky ? 'This remediation overwrites current asset content.' : null,
              snapshotId: snapshot?.id || null,
            });
            rescan();
            return send(200, { ok: true, snapshotId: snapshot?.id || null });
          }

          return send(400, { ok: false, error: 'Unsupported remediation action' });
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // GET /api/projects/:id/remediations — suggested fixes for a project policy state
    if (url.pathname.match(/^\/api\/projects\/([^/]+)\/remediations$/) && req.method === 'GET') {
      const projectId = decodeURIComponent(url.pathname.split('/')[3]);
      return (async () => {
        const project = store.getProjects().find((entry) => entry.id === projectId) || null;
        if (!project) return send(404, { ok: false, error: 'Project not found' });
        const evaluation = await buildCurrentPolicyEvaluation();
        const suggestions = await remediation.buildProjectRemediations(project, {
          policyStatus: evaluation.byProjectId[projectId] || null,
          localCandidates: collectLocalCandidateAssets(),
          previewSyncRequest,
        });
        return send(200, { ok: true, data: suggestions });
      })().catch((err) => send(500, { ok: false, error: err.message }));
    }

    // POST /api/projects/:id/remediations/:remediationId/apply — apply a project remediation
    if (url.pathname.match(/^\/api\/projects\/([^/]+)\/remediations\/([^/]+)\/apply$/) && req.method === 'POST') {
      const [, , , rawProjectId, , rawRemediationId] = url.pathname.split('/');
      const projectId = decodeURIComponent(rawProjectId);
      const remediationId = decodeURIComponent(rawRemediationId);
      return readBody().then(async (body) => {
        const project = store.getProjects().find((entry) => entry.id === projectId) || null;
        if (!project) return send(404, { ok: false, error: 'Project not found' });
        const blocked = writeBlockReason({
          actionLabel: 'Project remediation',
          serverIds: project.environment_type === 'remote' ? [project.environment_id].filter(Boolean) : [],
        });
        if (blocked) return blockWrite(blocked);

        const evaluation = await buildCurrentPolicyEvaluation();
        const suggestions = await remediation.buildProjectRemediations(project, {
          policyStatus: evaluation.byProjectId[projectId] || null,
          localCandidates: collectLocalCandidateAssets(),
          previewSyncRequest,
        });
        const suggestion = suggestions.find((entry) => entry.id === remediationId);
        if (!suggestion) return send(404, { ok: false, error: 'Remediation not found' });
        if (!suggestion.syncRequest || !suggestion.canApply) {
          return send(400, { ok: false, error: 'This remediation cannot be applied automatically' });
        }
        if (suggestion.risky && !body?.confirmRisk) {
          return send(409, { ok: false, error: 'Remediation requires confirmation because it will overwrite existing project content.' });
        }
        try {
          const result = await applySyncRequest(suggestion.syncRequest, {
            remediationId: suggestion.id,
            subjectKind: 'project',
            subjectId: projectId,
            title: suggestion.title,
            approval: normalizeApproval(body?.approval || (body?.confirmRisk ? { confirmed: true } : null), {
              required: suggestion.risky,
              reason: suggestion.risky ? 'This remediation overwrites existing project content.' : null,
            }),
            requireApproval: suggestion.risky,
            approvalReason: suggestion.risky ? 'This remediation overwrites existing project content.' : null,
          });
          if (!result.ok) return send(400, result);
          return send(200, { ok: true, data: result });
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // GET /api/servers/:id/remediations — suggested fixes for an environment policy state
    if (url.pathname.match(/^\/api\/servers\/([^/]+)\/remediations$/) && req.method === 'GET') {
      const serverId = decodeURIComponent(url.pathname.split('/')[3]);
      return (async () => {
        const environment = getEnvironmentById(serverId);
        if (!environment) return send(404, { ok: false, error: 'Server not found' });
        const evaluation = await buildCurrentPolicyEvaluation();
        const suggestions = await remediation.buildEnvironmentRemediations(environment, {
          policyStatus: evaluation.byEnvironmentId[serverId] || null,
          localCandidates: collectLocalCandidateAssets(),
          previewSyncRequest,
        });
        return send(200, { ok: true, data: suggestions });
      })().catch((err) => send(500, { ok: false, error: err.message }));
    }

    // POST /api/servers/:id/remediations/:remediationId/apply — apply an environment remediation
    if (url.pathname.match(/^\/api\/servers\/([^/]+)\/remediations\/([^/]+)\/apply$/) && req.method === 'POST') {
      const [, , , rawServerId, , rawRemediationId] = url.pathname.split('/');
      const serverId = decodeURIComponent(rawServerId);
      const remediationId = decodeURIComponent(rawRemediationId);
      return readBody().then(async (body) => {
        const environment = getEnvironmentById(serverId);
        if (!environment) return send(404, { ok: false, error: 'Server not found' });
        const blocked = writeBlockReason({
          actionLabel: 'Server remediation',
          serverIds: environment.type === 'remote' ? [environment.id] : [],
        });
        if (blocked) return blockWrite(blocked);

        const evaluation = await buildCurrentPolicyEvaluation();
        const suggestions = await remediation.buildEnvironmentRemediations(environment, {
          policyStatus: evaluation.byEnvironmentId[serverId] || null,
          localCandidates: collectLocalCandidateAssets(),
          previewSyncRequest,
        });
        const suggestion = suggestions.find((entry) => entry.id === remediationId);
        if (!suggestion) return send(404, { ok: false, error: 'Remediation not found' });
        if (!suggestion.syncRequest || !suggestion.canApply) {
          return send(400, { ok: false, error: 'This remediation cannot be applied automatically' });
        }
        if (suggestion.risky && !body?.confirmRisk) {
          return send(409, { ok: false, error: 'Remediation requires confirmation because it will overwrite existing configuration.' });
        }
        try {
          const result = await applySyncRequest(suggestion.syncRequest, {
            remediationId: suggestion.id,
            subjectKind: 'environment',
            subjectId: serverId,
            title: suggestion.title,
            approval: normalizeApproval(body?.approval || (body?.confirmRisk ? { confirmed: true } : null), {
              required: suggestion.risky,
              reason: suggestion.risky ? 'This remediation overwrites existing configuration.' : null,
            }),
            requireApproval: suggestion.risky,
            approvalReason: suggestion.risky ? 'This remediation overwrites existing configuration.' : null,
          });
          if (!result.ok) return send(400, result);
          return send(200, { ok: true, data: result });
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // GET /api/environments
    if (url.pathname === '/api/environments' && req.method === 'GET') {
      return send(200, { ok: true, data: store.getEnvironments() });
    }

    // GET /api/history
    if (url.pathname === '/api/history' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit')) || 50;
      return send(200, { ok: true, data: store.getHistory(limit) });
    }

    // POST /api/history/:id/rollback
    if (url.pathname.match(/^\/api\/history\/(\d+)\/rollback$/) && req.method === 'POST') {
      return readBody().then((body) => {
        const historyId = Number(url.pathname.split('/')[3]);
        const entry = store.getHistoryEntry(historyId);
        if (!entry) return send(404, { ok: false, error: 'History entry not found' });
        if (!entry.can_rollback || !entry.snapshot_id) {
          return send(400, { ok: false, error: 'Rollback is not available for this history entry' });
        }
        const snapshot = entry.snapshot_id ? store.getSnapshot(entry.snapshot_id) : null;
        const blocked = writeBlockReason({
          actionLabel: 'Rollback',
          serverIds: (snapshot?.entries || []).map((item) => item.environmentId).filter(Boolean),
        });
        if (blocked) return blockWrite(blocked);
        const approvalRequirement = buildApprovalRequirementForSnapshotRollback(snapshot);
        const approval = requireApproval({
          required: approvalRequirement.required,
          approval: body?.approval,
          reason: approvalRequirement.reason,
        });
        if (approval?.ok === false) {
          return send(409, approval);
        }

        snapshots.rollbackSnapshot(entry.snapshot_id, { getEnvironmentById })
          .then(async (result) => {
            if (!result.ok) {
              return send(result.conflicts?.length ? 409 : 400, result);
            }
            store.markHistoryReverted(historyId);
            const remoteIds = [...new Set((result.snapshot?.entries || [])
              .map((snapshotEntry) => snapshotEntry.environmentId)
              .filter(Boolean))];
            for (const environmentId of remoteIds) {
              await refreshRemoteEnvironment(environmentId);
            }
            recordHistoryAction('rollback', entry.asset_name || `history #${historyId}`, {
              summary: `Rolled back history entry #${historyId}`,
              approval,
              approvalRequired: approvalRequirement.required,
              approvalReason: approvalRequirement.reason,
              restored: result.restored,
              target: entry.details_json?.target || null,
              metadata: { rolledBackHistoryId: historyId },
            });
            rescan();
            return send(200, { ok: true, historyId, snapshotId: entry.snapshot_id, restored: result.restored });
          })
          .catch((err) => send(500, { ok: false, error: err.message }));
        return;
      });
    }

    // POST /api/undo
    if (url.pathname === '/api/undo' && req.method === 'POST') {
      return readBody().then((body) => {
        const latest = store.undoLast();
        if (!latest.ok) return send(400, latest);
        const snapshot = latest.history.snapshot_id ? store.getSnapshot(latest.history.snapshot_id) : null;
        const blocked = writeBlockReason({
          actionLabel: 'Undo',
          serverIds: (snapshot?.entries || []).map((item) => item.environmentId).filter(Boolean),
        });
        if (blocked) return blockWrite(blocked);
        const approvalRequirement = buildApprovalRequirementForSnapshotRollback(snapshot);
        const approval = requireApproval({
          required: approvalRequirement.required,
          approval: body?.approval,
          reason: approvalRequirement.reason,
        });
        if (approval?.ok === false) {
          return send(409, approval);
        }

        snapshots.rollbackSnapshot(latest.history.snapshot_id, { getEnvironmentById })
          .then(async (result) => {
            if (!result.ok) {
              return send(result.conflicts?.length ? 409 : 400, result);
            }
            store.markHistoryReverted(latest.history.id);
            const remoteIds = [...new Set((result.snapshot?.entries || [])
              .map((snapshotEntry) => snapshotEntry.environmentId)
              .filter(Boolean))];
            for (const environmentId of remoteIds) {
              await refreshRemoteEnvironment(environmentId);
            }
            recordHistoryAction('undo', latest.history.asset_name || `history #${latest.history.id}`, {
              summary: `Undid latest history entry #${latest.history.id}`,
              approval,
              approvalRequired: approvalRequirement.required,
              approvalReason: approvalRequirement.reason,
              restored: result.restored,
              target: latest.history.details_json?.target || null,
              metadata: { undoneHistoryId: latest.history.id },
            });
            rescan();
            return send(200, {
              ok: true,
              historyId: latest.history.id,
              snapshotId: latest.history.snapshot_id,
              restored: result.restored,
            });
          })
          .catch((err) => send(500, { ok: false, error: err.message }));
        return;
      });
    }

    // GET /api/policies
    if (url.pathname === '/api/policies' && req.method === 'GET') {
      return send(200, { ok: true, data: store.getPolicies ? store.getPolicies() : [] });
    }

    // GET /api/policies/evaluate
    if (url.pathname === '/api/policies/evaluate' && req.method === 'GET') {
      return buildCurrentPolicyEvaluation()
        .then((evaluation) => send(200, { ok: true, data: evaluation }))
        .catch((err) => send(500, { ok: false, error: err.message }));
    }

    // POST /api/policies
    if (url.pathname === '/api/policies' && req.method === 'POST') {
      const blocked = writeBlockReason({ actionLabel: 'Creating policy' });
      if (blocked) return blockWrite(blocked);
      return readBody().then((body) => {
        try {
          const normalized = policies.normalizePolicyInput(body || {});
          const policy = store.createPolicy(normalized);
          recordHistoryAction('policy:create', policy.name, {
            policyId: policy.id,
            severity: policy.severity,
            enabled: policy.enabled,
          });
          return send(200, { ok: true, data: policy });
        } catch (err) {
          return send(400, { ok: false, error: err.message });
        }
      });
    }

    // GET /api/policies/:id
    if (url.pathname.match(/^\/api\/policies\/([^/]+)$/) && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.split('/')[3]);
      const policy = store.getPolicyById ? store.getPolicyById(id) : null;
      if (!policy) return send(404, { ok: false, error: 'Policy not found' });
      return send(200, { ok: true, data: policy });
    }

    // PUT /api/policies/:id
    if (url.pathname.match(/^\/api\/policies\/([^/]+)$/) && req.method === 'PUT') {
      const blocked = writeBlockReason({ actionLabel: 'Updating policy' });
      if (blocked) return blockWrite(blocked);
      const id = decodeURIComponent(url.pathname.split('/')[3]);
      return readBody().then((body) => {
        try {
          const normalized = policies.normalizePolicyInput(body || {}, { partial: true });
          const policy = store.updatePolicy(id, normalized);
          recordHistoryAction('policy:update', policy.name, {
            policyId: policy.id,
            severity: policy.severity,
            enabled: policy.enabled,
          });
          return send(200, { ok: true, data: policy });
        } catch (err) {
          const message = err.message || 'Failed to update policy';
          if (message === 'Policy not found') return send(404, { ok: false, error: message });
          return send(400, { ok: false, error: message });
        }
      });
    }

    // DELETE /api/policies/:id
    if (url.pathname.match(/^\/api\/policies\/([^/]+)$/) && req.method === 'DELETE') {
      const blocked = writeBlockReason({ actionLabel: 'Deleting policy' });
      if (blocked) return blockWrite(blocked);
      const id = decodeURIComponent(url.pathname.split('/')[3]);
      const policy = store.getPolicyById ? store.getPolicyById(id) : null;
      if (!policy) return send(404, { ok: false, error: 'Policy not found' });
      const deleted = store.deletePolicy ? store.deletePolicy(id) : false;
      if (!deleted) return send(500, { ok: false, error: 'Failed to delete policy' });
      recordHistoryAction('policy:delete', policy.name, { policyId: policy.id });
      return send(200, { ok: true });
    }

    // POST /api/manifest/export
    if (url.pathname === '/api/manifest/export' && req.method === 'POST') {
      return readBody().then((body) => {
        try {
          const data = manifest.exportManifest(body || {}, buildManifestContext());
          return send(200, { ok: true, data });
        } catch (err) {
          return send(400, { ok: false, error: err.message });
        }
      });
    }

    // POST /api/manifest/preview-import
    if (url.pathname === '/api/manifest/preview-import' && req.method === 'POST') {
      return readBody().then((body) => {
        if (!body?.manifest) {
          return send(400, { ok: false, error: 'manifest is required' });
        }
        try {
          const data = manifest.previewImport(body.manifest, buildManifestContext());
          return send(200, { ok: true, data });
        } catch (err) {
          return send(400, { ok: false, error: err.message });
        }
      });
    }

    // POST /api/manifest/apply-import
    if (url.pathname === '/api/manifest/apply-import' && req.method === 'POST') {
      return readBody().then(async (body) => {
        const blocked = writeBlockReason({ actionLabel: 'Manifest import' });
        if (blocked) return blockWrite(blocked);
        if (!body?.manifest) {
          return send(400, { ok: false, error: 'manifest is required' });
        }
        try {
          const preview = manifest.previewImport(body.manifest, buildManifestContext());
          const approvalRequired = preview.counts.assets.update + preview.counts.bundles.update + preview.counts.policies.update > 0
            || preview.writeCount > 3;
          const approvalReason = approvalRequired
            ? 'Manifest import will overwrite existing harness configuration.'
            : null;
          const approval = requireApproval({
            required: approvalRequired,
            approval: body?.approval,
            reason: approvalReason,
          });
          if (approval?.ok === false) {
            return send(409, approval);
          }
          const snapshotSession = await beginWriteSnapshot({
            action: 'manifest-import',
            label: 'Import workspace manifest',
            entries: preview.assets
              .filter((entry) => ['create', 'update'].includes(entry.action) && entry.targetPath)
              .map((entry) => ({ transport: 'local', targetPath: entry.targetPath })),
            metadata: {
              manifest: preview.manifest,
              counts: preview.counts,
              approval,
              approvalRequired,
              approvalReason,
            },
          });
          const result = manifest.applyImport(body.manifest, buildManifestContext());
          if (!result.ok) {
            return send(400, result);
          }
          const snapshot = await finalizeWriteSnapshot(snapshotSession);
          recordHistoryAction('manifest:import', 'workspace-manifest', {
            manifestKind: preview.manifest.kind,
            counts: preview.counts,
            writeCount: result.result.writeCount,
            approval,
            approvalRequired,
            approvalReason,
            snapshotId: snapshot?.id || null,
          });
          rescan();
          return send(200, { ok: true, data: { preview, result: result.result } });
        } catch (err) {
          return send(400, { ok: false, error: err.message });
        }
      });
    }

    // GET /api/bundles
    if (url.pathname === '/api/bundles' && req.method === 'GET') {
      return send(200, { ok: true, data: store.getBundles ? store.getBundles() : [] });
    }

    // POST /api/bundles — create reusable harness bundle
    if (url.pathname === '/api/bundles' && req.method === 'POST') {
      return readBody().then((body) => {
        if (!body?.name || !Array.isArray(body?.items) || body.items.length === 0) {
          return send(400, { ok: false, error: 'name and at least one item are required' });
        }
        try {
          const bundle = store.createBundle({
            name: body.name,
            description: body.description || '',
            items: body.items,
            versionLabel: body.versionLabel || '',
          });
          recordHistoryAction('bundle:create', bundle.name, {
            bundleId: bundle.id,
            version: bundle.current_version,
            itemCount: bundle.itemCount,
          });
          return send(200, { ok: true, data: bundle });
        } catch (err) {
          return send(400, { ok: false, error: err.message });
        }
      });
    }

    // GET /api/bundles/:id
    if (url.pathname.match(/^\/api\/bundles\/([^/]+)$/) && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.split('/')[3]);
      const bundle = store.getBundleById ? store.getBundleById(id) : null;
      if (!bundle) return send(404, { ok: false, error: 'Bundle not found' });
      return send(200, { ok: true, data: bundle });
    }

    // PUT /api/bundles/:id — update bundle metadata/items and create a new version when content changes
    if (url.pathname.match(/^\/api\/bundles\/([^/]+)$/) && req.method === 'PUT') {
      const id = decodeURIComponent(url.pathname.split('/')[3]);
      return readBody().then((body) => {
        try {
          const bundle = store.updateBundle(id, {
            name: body?.name,
            description: body?.description,
            items: body?.items,
            versionLabel: body?.versionLabel || '',
          });
          recordHistoryAction('bundle:update', bundle.name, {
            bundleId: bundle.id,
            version: bundle.current_version,
            itemCount: bundle.itemCount,
          });
          return send(200, { ok: true, data: bundle });
        } catch (err) {
          return send(err.message === 'Bundle not found' ? 404 : 400, { ok: false, error: err.message });
        }
      });
    }

    // DELETE /api/bundles/:id
    if (url.pathname.match(/^\/api\/bundles\/([^/]+)$/) && req.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.split('/')[3]);
      const bundle = store.getBundleById ? store.getBundleById(id) : null;
      if (!bundle) return send(404, { ok: false, error: 'Bundle not found' });
      const deleted = store.deleteBundle ? store.deleteBundle(id) : false;
      if (!deleted) return send(500, { ok: false, error: 'Failed to delete bundle' });
      recordHistoryAction('bundle:delete', bundle.name, {
        bundleId: bundle.id,
        version: bundle.current_version,
      });
      return send(200, { ok: true, id });
    }

    // POST /api/bundles/:id/preview
    if (url.pathname.match(/^\/api\/bundles\/([^/]+)\/preview$/) && req.method === 'POST') {
      const id = decodeURIComponent(url.pathname.split('/')[3]);
      const bundle = store.getBundleById ? store.getBundleById(id) : null;
      if (!bundle) return send(404, { ok: false, error: 'Bundle not found' });
      return readBody().then(async (body) => {
        if (!body?.target?.kind) {
          return send(400, { ok: false, error: 'target is required' });
        }
        try {
          const dependencyGraph = buildCurrentDependencyGraph();
          const result = await bundles.previewBundle(bundle, body.target, {
            resolveAsset,
            getEnvironmentById,
            getProjects: () => store.getProjects(),
            getRunningAgentById,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            recordBundleApplication: (payload) => store.recordBundleApplication(payload),
            projectRoot,
            dependencyGraph,
          });
          return send(200, { ok: true, data: result });
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // POST /api/bundles/:id/apply
    if (url.pathname.match(/^\/api\/bundles\/([^/]+)\/apply$/) && req.method === 'POST') {
      const id = decodeURIComponent(url.pathname.split('/')[3]);
      const bundle = store.getBundleById ? store.getBundleById(id) : null;
      if (!bundle) return send(404, { ok: false, error: 'Bundle not found' });
      return readBody().then(async (body) => {
        if (!body?.target?.kind) {
          return send(400, { ok: false, error: 'target is required' });
        }
        const blocked = writeBlockReason({
          actionLabel: 'Bundle apply',
          serverIds: body.target.kind === 'server' && body.target.serverId ? [body.target.serverId] : [],
        });
        if (blocked) return blockWrite(blocked);

        try {
          const previewResult = await bundles.previewBundle(bundle, body.target, {
            resolveAsset,
            getEnvironmentById,
            getProjects: () => store.getProjects(),
            getRunningAgentById,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            recordBundleApplication: (payload) => store.recordBundleApplication(payload),
            projectRoot,
            dependencyGraph: buildCurrentDependencyGraph(),
          });
          const descriptors = (previewResult.preview?.results || [])
            .flatMap((entry) => entry.ok ? buildSyncDescriptors(entry.plan) : []);
          const snapshotSession = await beginWriteSnapshot({
            action: 'bundle-apply',
            label: `Apply bundle ${bundle.name} v${bundle.current_version}`,
            entries: descriptors,
            metadata: {
              bundleId: bundle.id,
              bundleVersion: bundle.current_version,
              target: previewResult.target || body.target,
            },
          });
          const result = await bundles.applyBundle(bundle, body.target, {
            resolveAsset,
            getEnvironmentById,
            getProjects: () => store.getProjects(),
            getRunningAgentById,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            recordBundleApplication: (payload) => store.recordBundleApplication(payload),
            projectRoot,
            dependencyGraph: buildCurrentDependencyGraph(),
          });
          if (!result.result) {
            return send(400, { ok: false, error: result.error || 'Bundle apply is blocked', data: result });
          }
          const snapshot = await finalizeWriteSnapshot(snapshotSession);
          if (body.target.kind === 'server' && body.target.serverId) {
            await refreshRemoteEnvironment(body.target.serverId);
          }
          recordHistoryAction('bundle:apply', bundle.name, {
            bundleId: bundle.id,
            version: bundle.current_version,
            target: result.target || body.target,
            applied: result.result.appliedCount,
            skipped: result.result.skippedCount,
            snapshotId: snapshot?.id || null,
          });
          rescan();
          return send(200, { ok: result.ok, data: result });
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // POST /api/rescan
    if (url.pathname === '/api/rescan' && req.method === 'POST') {
      const data = rescan();
      return send(200, { ok: true, count: data.length });
    }

    // POST /api/sync/preview — build sync preview plan
    if (url.pathname === '/api/sync/preview' && req.method === 'POST') {
      return readBody().then(async (body) => {
        if (!body?.source || !body?.target?.kind) {
          return send(400, { ok: false, error: 'source and target are required' });
        }
        try {
          const dependencyGraph = buildCurrentDependencyGraph();
          const plan = await sync.previewSync(body, {
            resolveAsset,
            getEnvironmentById: (id) => store.getEnvironments().find((env) => env.id === id) || null,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
            dependencyGraph,
          });
          return send(200, { ok: true, plan });
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // POST /api/sync/apply — execute sync plan
    if (url.pathname === '/api/sync/apply' && req.method === 'POST') {
      return readBody().then(async (body) => {
        if (!body?.source || !body?.target?.kind) {
          return send(400, { ok: false, error: 'source and target are required' });
        }
        const blocked = writeBlockReason({
          actionLabel: 'Sync apply',
          serverIds: body?.target?.kind === 'server' && body?.target?.serverId ? [body.target.serverId] : [],
        });
        if (blocked) return blockWrite(blocked);
        try {
          const previewPlan = await sync.previewSync(body, {
            resolveAsset,
            getEnvironmentById,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
          });
          const approvalRequirement = buildApprovalRequirementForSyncPlan(previewPlan);
          const approval = requireApproval({
            required: approvalRequirement.required,
            approval: body?.approval,
            reason: approvalRequirement.reason,
          });
          if (approval?.ok === false) {
            return send(409, approval);
          }
          const snapshotSession = await beginWriteSnapshot({
            action: 'sync',
            label: `Sync ${previewPlan.source?.type || body.source.type} ${previewPlan.source?.name || body.source.name}`,
            entries: buildSyncDescriptors(previewPlan),
            metadata: {
              target: previewPlan.target || body.target,
              approval,
              approvalRequired: approvalRequirement.required,
              approvalReason: approvalRequirement.reason,
            },
          });
          const result = await sync.applySync(body, {
            resolveAsset,
            getEnvironmentById,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
          });
          if (!result.ok) return send(400, result);
          const snapshot = await finalizeWriteSnapshot(snapshotSession);

          if (body.target.kind === 'server' && body.target.serverId) {
            try {
              await refreshRemoteEnvironment(body.target.serverId);
            } catch (err) {
              return send(500, { ok: false, error: `Sync applied but remote rescan failed: ${err.message}`, plan: result.plan });
            }
          }

          recordHistoryAction('sync', result.plan?.source?.name || body.source.name || 'asset', {
            target: result.plan?.target || body.target,
            applied: result.applied,
            skipped: result.skipped,
            operationCount: result.plan?.operations?.length || previewPlan.operations?.length || 0,
            approval,
            approvalRequired: approvalRequirement.required,
            approvalReason: approvalRequirement.reason,
            snapshotId: snapshot?.id || null,
          });
          rescan();
          return send(200, result);
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // POST /api/batch/sync/preview — build batch sync preview plans
    if (url.pathname === '/api/batch/sync/preview' && req.method === 'POST') {
      return readBody().then(async (body) => {
        if (!Array.isArray(body?.requests) || body.requests.length === 0) {
          return send(400, { ok: false, error: 'requests array is required' });
        }
        try {
          const dependencyGraph = buildCurrentDependencyGraph();
          const result = await batch.previewBatchSync(body, {
            resolveAsset,
            getEnvironmentById: (id) => store.getEnvironments().find((env) => env.id === id) || null,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
            dependencyGraph,
          });
          return send(200, result);
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // POST /api/batch/sync/apply — execute batch sync
    if (url.pathname === '/api/batch/sync/apply' && req.method === 'POST') {
      return readBody().then(async (body) => {
        if (!Array.isArray(body?.requests) || body.requests.length === 0) {
          return send(400, { ok: false, error: 'requests array is required' });
        }
        const blocked = writeBlockReason({
          actionLabel: 'Batch sync apply',
          serverIds: body.requests
            .map((request) => request?.target?.kind === 'server' ? request?.target?.serverId : null)
            .filter(Boolean),
        });
        if (blocked) return blockWrite(blocked);
        try {
          const preview = await batch.previewBatchSync(body, {
            resolveAsset,
            getEnvironmentById,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
          });
          const approvalRequirement = buildApprovalRequirementForBatchSync(preview);
          const approval = requireApproval({
            required: approvalRequirement.required,
            approval: body?.approval,
            reason: approvalRequirement.reason,
          });
          if (approval?.ok === false) {
            return send(409, approval);
          }
          const descriptors = preview.results.flatMap((entry) => entry.ok ? buildSyncDescriptors(entry.plan) : []);
          const snapshotSession = await beginWriteSnapshot({
            action: 'batch-sync',
            label: `Batch sync ${body.requests.length} assets`,
            entries: descriptors,
            metadata: {
              total: body.requests.length,
              approval,
              approvalRequired: approvalRequirement.required,
              approvalReason: approvalRequirement.reason,
            },
          });
          const result = await batch.applyBatchSync(body, {
            resolveAsset,
            getEnvironmentById,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
          });
          if (result.successCount > 0) {
            const snapshot = await finalizeWriteSnapshot(snapshotSession);
            recordHistoryAction('batch-sync', `${result.successCount} assets`, {
              total: result.total,
              applied: result.appliedCount,
              skipped: result.skippedCount,
              operationCount: preview.operationCount || descriptors.length,
              approval,
              approvalRequired: approvalRequirement.required,
              approvalReason: approvalRequirement.reason,
              snapshotId: snapshot?.id || null,
            });
            const remoteIds = [...new Set(descriptors.map((entry) => entry.environmentId).filter(Boolean))];
            for (const environmentId of remoteIds) {
              await refreshRemoteEnvironment(environmentId);
            }
            rescan();
          }
          return send(200, result);
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // POST /api/assets/move — move/copy asset between projects
    if (url.pathname === '/api/assets/move' && req.method === 'POST') {
      return readBody().then(async (body) => {
        const blocked = writeBlockReason({ actionLabel: 'Project sync' });
        if (blocked) return blockWrite(blocked);
        if (!body || !body.targetProjectPath || !body.type) {
          return send(400, { ok: false, error: 'targetProjectPath and type required' });
        }

        try {
          const previewPlan = await sync.previewSync({
            source: {
              assetId: body.assetId,
              name: body.name,
              type: body.type,
              filePath: body.sourcePath,
              providers: body.provider ? [body.provider] : [],
              rawConfig: body.config || null,
              projectPath: body.projectPath || null,
            },
            target: {
              kind: 'project',
              projectPath: body.targetProjectPath,
              method: body.method || 'copy',
            },
          }, {
            resolveAsset,
            getEnvironmentById,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
          });
          const snapshotSession = await beginWriteSnapshot({
            action: 'move',
            label: `Move ${body.type} ${body.name}`,
            entries: buildSyncDescriptors(previewPlan),
            metadata: { targetProjectPath: body.targetProjectPath, method: body.method || 'copy' },
          });
          const result = await sync.applySync({
            source: {
              assetId: body.assetId,
              name: body.name,
              type: body.type,
              filePath: body.sourcePath,
              providers: body.provider ? [body.provider] : [],
              rawConfig: body.config || null,
              projectPath: body.projectPath || null,
            },
            target: {
              kind: 'project',
              projectPath: body.targetProjectPath,
              method: body.method || 'copy',
            },
          }, {
            resolveAsset,
            getEnvironmentById,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
          });
          if (!result.ok) return send(400, result);
          const primaryOperation = result.plan.operations[0];
          const snapshot = await finalizeWriteSnapshot(snapshotSession);
          recordHistoryAction('move', result.plan.source.name || body.name, {
            from: result.plan.source.filePath || body.sourcePath || null,
            to: primaryOperation?.targetPath || body.targetProjectPath,
            method: body.method || 'copy',
            type: body.type,
            snapshotId: snapshot?.id || null,
          });
          rescan();
          return send(200, {
            ok: true,
            targetPath: primaryOperation?.targetPath || null,
            method: body.method || 'copy',
            plan: result.plan,
            applied: result.applied,
            skipped: result.skipped,
          });
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // ─── MCP Server Inspection ─────────────────────────

    // GET /api/mcp/:name/config — get MCP server config
    if (url.pathname.match(/^\/api\/mcp\/(.+)\/config$/) && req.method === 'GET') {
      const assetRef = decodeURIComponent(url.pathname.split('/')[3]);
      return resolveRuntimeAsset(assetRef, 'mcp')
        .then((source) => {
          const fallback = source ? null : mcpClient.getMcpConfig(assetRef, claudeDir, projectRoot);
          const config = source?.rawConfig || fallback?.config || null;
          const sourcePath = source?.filePath || fallback?.source || null;
          if (!config || !sourcePath) return send(404, { ok: false, error: 'MCP server not found in config' });
          return send(200, { ok: true, config, source: sourcePath });
        })
        .catch((err) => send(500, { ok: false, error: err.message }));
    }

    // GET /api/mcp/:name/runtime — return cached runtime diagnostics
    if (url.pathname.match(/^\/api\/mcp\/(.+)\/runtime$/) && req.method === 'GET') {
      const assetRef = decodeURIComponent(url.pathname.split('/')[3]);
      return resolveRuntimeAsset(assetRef, 'mcp')
        .then((source) => {
          if (!source) return send(404, { ok: false, error: 'MCP server not found' });
          return send(200, { ok: true, data: mcpRuntime.getCachedRuntime(source) });
        })
        .catch((err) => send(500, { ok: false, error: err.message }));
    }

    // POST /api/mcp/:name/runtime — run runtime diagnostics and cache result
    if (url.pathname.match(/^\/api\/mcp\/(.+)\/runtime$/) && req.method === 'POST') {
      const assetRef = decodeURIComponent(url.pathname.split('/')[3]);
      return readBody()
        .then(async (body) => {
          const source = await resolveRuntimeAsset(assetRef, 'mcp');
          if (!source) return send(404, { ok: false, error: 'MCP server not found' });
          const data = await mcpRuntime.checkMcpRuntime(source, {
            force: body?.force !== false,
            timeoutMs: typeof body?.timeoutMs === 'number' ? body.timeoutMs : undefined,
          });
          return send(200, { ok: true, data });
        })
        .catch((err) => send(500, { ok: false, error: err.message }));
    }

    // POST /api/mcp/:name/tools — connect and list tools
    if (url.pathname.match(/^\/api\/mcp\/(.+)\/tools$/) && req.method === 'POST') {
      const assetRef = decodeURIComponent(url.pathname.split('/')[3]);
      return resolveRuntimeAsset(assetRef, 'mcp')
        .then(async (source) => {
          if (!source) return send(404, { ok: false, error: 'MCP server not found' });
          const runtime = await mcpRuntime.checkMcpRuntime(source, { force: true });
          return send(200, {
            ok: runtime.status === 'ok',
            runtime,
            tools: runtime.tools || [],
            count: runtime.toolCount || 0,
            error: runtime.status === 'ok' ? null : runtime.summary,
          });
        })
        .catch(err => send(500, { ok: false, error: err.message }));
    }

    // ─── Running Agents ──────────────────────────────────

    // GET /api/running-agents — list configured running agents
    if (url.pathname === '/api/running-agents' && req.method === 'GET') {
      const agents = decorateRunningAgentList(store.getRunningAgents ? store.getRunningAgents() : []);
      return send(200, { ok: true, data: agents });
    }

    // POST /api/running-agents/add — add a running agent endpoint
    if (url.pathname === '/api/running-agents/add' && req.method === 'POST') {
      return readBody().then(body => {
        if (!body || !body.name || !body.url) return send(400, { ok: false, error: 'Provide name and url' });
        const id = store.addRunningAgent ? store.addRunningAgent(body) : null;
        if (!id) return send(500, { ok: false, error: 'Store not ready' });
        agentIntrospection.clearCachedIntrospection(id);
        return send(200, { ok: true, id });
      });
    }

    // DELETE /api/running-agents/:id
    if (url.pathname.match(/^\/api\/running-agents\/([^/]+)$/) && req.method === 'DELETE') {
      const id = url.pathname.split('/')[3];
      if (store.removeRunningAgent) store.removeRunningAgent(id);
      agentIntrospection.clearCachedIntrospection(id);
      return send(200, { ok: true });
    }

    // GET /api/running-agents/:id/introspection — return cached introspection
    if (url.pathname.match(/^\/api\/running-agents\/([^/]+)\/introspection$/) && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.split('/')[3]);
      const agent = getRunningAgentById(id);
      if (!agent) return send(404, { ok: false, error: 'Agent not found' });
      return send(200, { ok: true, data: agentIntrospection.getCachedIntrospection(agent) });
    }

    // POST /api/running-agents/:id/introspection — run runtime introspection
    if (url.pathname.match(/^\/api\/running-agents\/([^/]+)\/introspection$/) && req.method === 'POST') {
      const id = decodeURIComponent(url.pathname.split('/')[3]);
      const agent = getRunningAgentById(id);
      if (!agent) return send(404, { ok: false, error: 'Agent not found' });

      return readBody()
        .then(async (body) => {
          const introspection = await runAgentIntrospection(agent, {
            force: body?.force !== false,
            timeoutMs: typeof body?.timeoutMs === 'number' ? body.timeoutMs : undefined,
          });
          return send(200, { ok: introspection.status === 'ok', data: introspection });
        })
        .catch((err) => send(500, { ok: false, error: err.message }));
    }

    // POST /api/running-agents/:id/tools — connect and list tools
    if (url.pathname.match(/^\/api\/running-agents\/([^/]+)\/tools$/) && req.method === 'POST') {
      const id = decodeURIComponent(url.pathname.split('/')[3]);
      const agent = getRunningAgentById(id);
      if (!agent) return send(404, { ok: false, error: 'Agent not found' });

      return readBody()
        .then(async (body) => {
          const introspection = await runAgentIntrospection(agent, {
            force: body?.force !== false,
            timeoutMs: typeof body?.timeoutMs === 'number' ? body.timeoutMs : undefined,
          });
          const tools = introspection.activeTools.map((tool) => ({
            name: tool.name,
            description: tool.description,
          }));
          return send(200, {
            ok: introspection.status === 'ok',
            tools,
            count: tools.length,
            introspection,
            error: introspection.status === 'ok' ? null : introspection.summary,
          });
        })
        .catch(err => send(500, { ok: false, error: err.message }));
    }

    // ─── Projects ────────────────────────────────────

    // GET /api/projects — list known projects
    if (url.pathname === '/api/projects' && req.method === 'GET') {
      return buildCurrentPolicyEvaluation()
        .then((evaluation) => send(200, {
          ok: true,
          data: store.getProjects().map((project) => ({
            ...decorateProject(project),
            policy: evaluation.byProjectId[project.id] || null,
          })),
        }))
        .catch((err) => send(500, { ok: false, error: err.message }));
    }

    // POST /api/projects/discover — scan directories for projects
    if (url.pathname === '/api/projects/discover' && req.method === 'POST') {
      return readBody().then(body => {
        const dirs = (body && body.dirs) || [];
        if (!dirs.length) return send(400, { ok: false, error: 'Provide dirs array' });
        const projects = discoverProjects(dirs);
        // Persist discovered projects
        for (const p of projects) {
          store.addProject(p.name, p.path);
        }
        return send(200, { ok: true, data: projects.map(decorateProject) });
      });
    }

    // POST /api/projects/add — add a single project by path
    if (url.pathname === '/api/projects/add' && req.method === 'POST') {
      return readBody().then(body => {
        if (!body || !body.path) return send(400, { ok: false, error: 'Provide path' });
        const project = addProjectByPath(body.path);
        if (!project) return send(404, { ok: false, error: 'Path not found' });
        const id = store.addProject(project.name, project.path);
        project.id = id;
        project.environment_id = store.getLocalEnvironmentId();
        project.environment_type = 'local';
        return send(200, { ok: true, data: decorateProject(project) });
      });
    }

    // PUT /api/projects/:id — update project metadata
    if (url.pathname.match(/^\/api\/projects\/([^/]+)$/) && req.method === 'PUT') {
      const blocked = writeBlockReason({ actionLabel: 'Updating project metadata' });
      if (blocked) return blockWrite(blocked);
      const projectId = decodeURIComponent(url.pathname.split('/')[3]);
      return readBody().then((body) => {
        const hasProjectType = body && Object.prototype.hasOwnProperty.call(body, 'project_type');
        if (!hasProjectType) {
          return send(400, { ok: false, error: 'project_type is required' });
        }

        const project = store.setProjectType ? store.setProjectType(projectId, body.project_type) : null;
        if (!project) return send(404, { ok: false, error: 'Project not found' });

          recordHistoryAction('project:update', project.name, {
          projectId: project.id,
          projectType: project.project_type || null,
        });

        return buildCurrentPolicyEvaluation()
          .then((evaluation) => send(200, {
            ok: true,
            data: {
              ...decorateProject(project),
              policy: evaluation.byProjectId[project.id] || null,
            },
          }))
          .catch((err) => send(500, { ok: false, error: err.message }));
      });
    }

    // GET /api/projects/:id/assets — assets for a known project id (local or remote)
    if (url.pathname.match(/^\/api\/projects\/([^/]+)\/assets-by-id$/) && req.method === 'GET') {
      const projectId = decodeURIComponent(url.pathname.split('/')[3]);
      const project = store.getProjectById ? store.getProjectById(projectId) : null;
      if (!project) return send(404, { ok: false, error: 'Project not found' });

      if (project.environment_type === 'remote') {
        const env = getEnvironmentById(project.environment_id);
        if (!env) return send(404, { ok: false, error: 'Remote environment not found' });
        return remote.scanRemoteProjectAssets(env, project.path)
          .then((assets) => {
            const decoratedAssets = decorateAssetList(assets);
            return send(200, { ok: true, data: decoratedAssets, total: decoratedAssets.length });
          })
          .catch((err) => send(500, { ok: false, error: err.message }));
      }

      const assets = decorateAssetList(scanProjectAssets(project.path, {
        environmentId: project.environment_id || store.getLocalEnvironmentId(),
        environmentType: 'local',
      }));
      return send(200, { ok: true, data: assets, total: assets.length });
    }

    // GET /api/projects/:path/assets — assets for a specific project
    if (url.pathname.match(/^\/api\/projects\/(.+)\/assets$/) && req.method === 'GET') {
      const projectPath = decodeURIComponent(url.pathname.split('/assets')[0].replace('/api/projects/', ''));
      const assets = decorateAssetList(scanProjectAssets(projectPath));
      return send(200, { ok: true, data: assets, total: assets.length });
    }

    // ─── Remote Servers ────────────────────────────────

    // GET /api/servers — list environments (local + remote)
    if (url.pathname === '/api/servers' && req.method === 'GET') {
      return buildCurrentPolicyEvaluation()
        .then((evaluation) => send(200, {
          ok: true,
          data: store.getEnvironments().map((environment) => ({
            ...environment,
            policy: evaluation.byEnvironmentId[environment.id] || null,
          })),
        }))
        .catch((err) => send(500, { ok: false, error: err.message }));
    }

    // POST /api/servers/:id/read-only — update per-server audit policy
    if (url.pathname.match(/^\/api\/servers\/([^/]+)\/read-only$/) && req.method === 'POST') {
      const envId = url.pathname.split('/')[3];
      return readBody().then((body) => {
        if (typeof body?.readOnly !== 'boolean') {
          return send(400, { ok: false, error: 'readOnly boolean is required' });
        }
        const environment = getEnvironmentById(envId);
        if (!environment || environment.type !== 'remote') {
          return send(404, { ok: false, error: 'Remote server not found' });
        }
        store.setEnvironmentReadOnly(envId, body.readOnly);
        return send(200, { ok: true, data: getAuditMode() });
      });
    }

    // POST /api/servers/add — add a remote server
    if (url.pathname === '/api/servers/add' && req.method === 'POST') {
      return readBody().then(body => {
        if (!body || !body.name || !body.ssh_host || !body.ssh_user) {
          return send(400, { ok: false, error: 'Provide name, ssh_host, ssh_user' });
        }
        const id = store.addEnvironment({
          name: body.name,
          type: 'remote',
          ssh_host: body.ssh_host,
          ssh_port: body.ssh_port || 22,
          ssh_user: body.ssh_user,
          ssh_key_path: body.ssh_key_path || null,
        });
        return send(200, { ok: true, id });
      });
    }

    // POST /api/servers/:id/test — test SSH connection
    if (url.pathname.match(/^\/api\/servers\/([^/]+)\/test$/) && req.method === 'POST') {
      const envId = url.pathname.split('/')[3];
      const envs = store.getEnvironments();
      const env = envs.find(e => e.id === envId);
      if (!env) return send(404, { ok: false, error: 'Server not found' });
      return remote.testConnection(env)
        .then(result => send(200, { ok: true, ...result }))
        .catch(err => send(500, { ok: false, error: err.message }));
    }

    // POST /api/servers/:id/scan — scan remote server for assets
    if (url.pathname.match(/^\/api\/servers\/([^/]+)\/scan$/) && req.method === 'POST') {
      const envId = url.pathname.split('/')[3];
      const envs = store.getEnvironments();
      const env = envs.find(e => e.id === envId);
      if (!env || env.type !== 'remote') return send(404, { ok: false, error: 'Remote server not found' });
      return remote.scanRemote(env)
        .then(assets => {
          const { categorize } = require('./categorizer');
          const categorized = categorize({
            skills: assets.filter(a => a.type === 'skill'),
            agents: assets.filter(a => a.type === 'agent'),
            mcpServers: assets.filter(a => a.type === 'mcp'),
            instructions: assets.filter(a => a.type === 'instruction'),
            rules: assets.filter(a => a.type === 'rule'),
          });
          store.upsertAssets(categorized, envId);
          const decoratedAssets = decorateAssetList(assets);
          return send(200, { ok: true, data: decoratedAssets, count: decoratedAssets.length });
        })
        .catch(err => send(500, { ok: false, error: err.message }));
    }

    // GET /api/servers/:id/projects — list projects known for a remote server
    if (url.pathname.match(/^\/api\/servers\/([^/]+)\/projects$/) && req.method === 'GET') {
      const envId = url.pathname.split('/')[3];
      return send(200, { ok: true, data: store.getProjects({ environment_id: envId }).map(decorateProject) });
    }

    // POST /api/servers/:id/projects/discover — discover projects on remote server
    if (url.pathname.match(/^\/api\/servers\/([^/]+)\/projects\/discover$/) && req.method === 'POST') {
      const envId = url.pathname.split('/')[3];
      const env = getEnvironmentById(envId);
      if (!env || env.type !== 'remote') return send(404, { ok: false, error: 'Remote server not found' });

      return readBody()
        .then(async (body) => {
          const dirs = Array.isArray(body?.dirs) ? body.dirs : [];
          const projects = await remote.discoverRemoteProjects(env, dirs);
          const enriched = projects.map((project) => {
            const id = store.addProject(project.name, project.path, env.id);
            return {
              ...project,
              id,
              git: null,
            };
          });
          return send(200, { ok: true, data: enriched, count: enriched.length });
        })
        .catch((err) => send(500, { ok: false, error: err.message }));
    }

    // GET /api/servers/:id/diff — diff local vs remote
    if (url.pathname.match(/^\/api\/servers\/([^/]+)\/diff$/) && req.method === 'GET') {
      const envId = url.pathname.split('/')[3];
      const localEnvId = store.getLocalEnvironmentId();
      const localAssets = decorateAssetList(store.getAssets({ environment_id: localEnvId }));
      const remoteAssets = decorateAssetList(store.getAssets({ environment_id: envId }));
      const diff = remote.diffAssets(localAssets, remoteAssets);
      return send(200, { ok: true, data: diff });
    }

    // POST /api/servers/:id/push — push asset to remote
    if (url.pathname.match(/^\/api\/servers\/([^/]+)\/push$/) && req.method === 'POST') {
      const envId = url.pathname.split('/')[3];
      return readBody().then(async (body) => {
        const blocked = writeBlockReason({ serverIds: [envId], actionLabel: 'Remote sync' });
        if (blocked) return blockWrite(blocked);
        if (!body || !body.name || !body.type) return send(400, { ok: false, error: 'Provide name and type' });
        const envs = store.getEnvironments();
        const env = envs.find(e => e.id === envId);
        if (!env) return send(404, { ok: false, error: 'Server not found' });

        try {
          const result = await sync.applySync({
            source: {
              assetId: body.assetId,
              name: body.name,
              type: body.type,
            },
            target: {
              kind: 'server',
              serverId: envId,
              direction: 'push',
            },
          }, {
            resolveAsset,
            getEnvironmentById: (id) => store.getEnvironments().find((entry) => entry.id === id) || null,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
          });
          if (!result.ok) return send(400, result);
          const primaryOperation = result.plan.operations[0];
          recordHistoryAction('push', body.name, { to: env.name, remotePath: primaryOperation?.targetPath || null });
          rescan();
          return send(200, { ok: true, remotePath: primaryOperation?.targetPath || null, plan: result.plan, applied: result.applied, skipped: result.skipped });
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // POST /api/servers/:id/pull — pull asset from remote
    if (url.pathname.match(/^\/api\/servers\/([^/]+)\/pull$/) && req.method === 'POST') {
      const envId = url.pathname.split('/')[3];
      return readBody().then(async (body) => {
        const blocked = writeBlockReason({ serverIds: [envId], actionLabel: 'Remote sync' });
        if (blocked) return blockWrite(blocked);
        if (!body || !body.type || (!body.remotePath && !body.assetId && !body.name)) {
          return send(400, { ok: false, error: 'Provide type and remote asset reference' });
        }
        const envs = store.getEnvironments();
        const env = envs.find(e => e.id === envId);
        if (!env) return send(404, { ok: false, error: 'Server not found' });

        try {
          const result = await sync.applySync({
            source: {
              assetId: body.assetId,
              name: body.name,
              type: body.type,
              filePath: body.remotePath,
              environmentId: envId,
            },
            target: {
              kind: 'server',
              serverId: envId,
              direction: 'pull',
            },
          }, {
            resolveAsset,
            getEnvironmentById: (id) => store.getEnvironments().find((entry) => entry.id === id) || null,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
          });
          if (!result.ok) return send(400, result);
          const primaryOperation = result.plan.operations[0];
          recordHistoryAction('pull', body.name, { from: env.name, localPath: primaryOperation?.targetPath || null });
          rescan();
          return send(200, { ok: true, localPath: primaryOperation?.targetPath || null, plan: result.plan, applied: result.applied, skipped: result.skipped });
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // 404
    send(404, { ok: false, error: 'Not found' });
  };
}

/**
 * Generate asset content using LLM API.
 * Supports ANTHROPIC_API_KEY or OPENAI_API_KEY.
 */
async function generateAssetContent(type, name, description) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const systemPrompts = {
    skill: `You are an expert at creating Claude Code skills (slash commands).
Generate a production-quality skill file in Markdown with YAML frontmatter.
The frontmatter MUST have: name (kebab-case), description (purpose + triggers + negative triggers, max 1024 chars).
The body should have: clear imperative steps, output format template, common mistakes section if relevant.
Keep body under 300 lines. Use concrete templates over prose.`,
    agent: `You are an expert at creating Claude Code agent definitions.
Generate a production-quality agent file in Markdown with YAML frontmatter.
The frontmatter MUST have: name (kebab-case), description (what the agent does), model (sonnet or opus).
The body should define: the agent's role, available tools, workflow steps, output expectations.`,
    rule: `You are an expert at creating IDE rules for AI coding assistants.
Generate a clear, concise rules file in Markdown.
Include: project context, coding guidelines, patterns to follow, things to avoid.`,
    instruction: `You are an expert at creating instruction files for AI coding assistants.
Generate a clear instruction file in Markdown.
Include: project context, tech stack, key rules, coding patterns.`,
  };

  const prompt = `Create a ${type} named "${name}".

User's description: ${description}

Generate the complete file content. Output ONLY the file content, no explanation.`;

  if (anthropicKey) {
    const https = require('https');
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompts[type] || systemPrompts.skill,
        messages: [{ role: 'user', content: prompt }],
      });
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (parsed.content && parsed.content[0]) {
              resolve(parsed.content[0].text);
            } else {
              reject(new Error(parsed.error?.message || 'No content in response'));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  if (openaiKey) {
    const https = require('https');
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompts[type] || systemPrompts.skill },
          { role: 'user', content: prompt },
        ],
        max_tokens: 4096,
      });
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (parsed.choices && parsed.choices[0]) {
              resolve(parsed.choices[0].message.content);
            } else {
              reject(new Error(parsed.error?.message || 'No content'));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  throw new Error('Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable to enable AI generation');
}

function defaultContent(name, type) {
  if (type === 'skill') {
    return `---\nname: ${name}\ndescription: ""\n---\n\n# ${name}\n\n`;
  }
  if (type === 'agent') {
    return `---\nname: ${name}\ndescription: ""\nmodel: sonnet\n---\n\n# ${name}\n\n`;
  }
  if (type === 'rule') {
    return `# ${name}\n\n`;
  }
  return `# ${name}\n\n`;
}

module.exports = { createRouter };
