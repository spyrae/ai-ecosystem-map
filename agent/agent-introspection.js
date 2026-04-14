'use strict';

const mcpClient = require('./mcp-client');
const { matchEnvironmentForAgent } = require('./topology');

const CACHE_TTL_MS = 60 * 1000;
const KNOWN_ASSET_TYPES = new Set(['skill', 'agent', 'mcp', 'instruction', 'rule']);

const introspectionCache = new Map();

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function buildUnknownIntrospection(agent, details = []) {
  return {
    agentId: agent.id,
    status: 'unknown',
    reachable: false,
    summary: 'Run introspection to verify which assets are only configured, loaded by the runtime, or actively exposed as tools.',
    details: details.length ? details : ['No runtime probe has been executed for this agent yet.'],
    checkedAt: null,
    durationMs: null,
    toolCount: null,
    configuredCount: 0,
    loadedCount: 0,
    activeCount: 0,
    activeToolCount: 0,
    unmatchedToolCount: 0,
    cached: false,
    stale: false,
    assets: [],
    activeTools: [],
  };
}

function finalizeIntrospection(agent, payload) {
  return {
    agentId: agent.id,
    status: payload.status || 'unknown',
    reachable: Boolean(payload.reachable),
    summary: payload.summary || 'Running agent introspection is unavailable.',
    details: Array.isArray(payload.details) ? payload.details : [],
    checkedAt: payload.checkedAt || new Date().toISOString(),
    durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : null,
    toolCount: typeof payload.toolCount === 'number' ? payload.toolCount : null,
    configuredCount: payload.configuredCount || 0,
    loadedCount: payload.loadedCount || 0,
    activeCount: payload.activeCount || 0,
    activeToolCount: payload.activeToolCount || 0,
    unmatchedToolCount: payload.unmatchedToolCount || 0,
    cached: Boolean(payload.cached),
    stale: Boolean(payload.stale),
    assets: Array.isArray(payload.assets) ? payload.assets : [],
    activeTools: Array.isArray(payload.activeTools) ? payload.activeTools : [],
  };
}

function getCachedIntrospection(agent) {
  if (!agent?.id) return null;
  const cached = introspectionCache.get(agent.id);
  if (!cached) return buildUnknownIntrospection(agent);

  const ageMs = Date.now() - cached.checkedAt;
  const stale = ageMs > CACHE_TTL_MS;
  return finalizeIntrospection(agent, {
    ...cached.result,
    cached: true,
    stale,
  });
}

function clearCachedIntrospection(agentId) {
  if (!agentId) return;
  introspectionCache.delete(agentId);
}

function mergeAssetCandidates(baseAssets, projectAssets, environmentId) {
  const merged = new Map();
  const add = (asset, extra = {}) => {
    if (!asset?.id || !KNOWN_ASSET_TYPES.has(asset.type)) return;
    if (environmentId && asset.environment_id && asset.environment_id !== environmentId) return;
    merged.set(asset.id, {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      environmentId: asset.environment_id || environmentId || null,
      projectId: extra.projectId || asset.projectId || null,
      projectName: extra.projectName || asset.projectName || null,
      projectPath: extra.projectPath || asset.projectPath || null,
      filePath: asset.filePath || null,
    });
  };

  for (const asset of baseAssets || []) add(asset);
  for (const entry of projectAssets || []) {
    add(entry.asset, {
      projectId: entry.project?.id || null,
      projectName: entry.project?.name || null,
      projectPath: entry.project?.path || null,
    });
  }

  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function assetDetail(asset, matchedTools) {
  const scope = asset.projectName ? `project ${asset.projectName}` : 'environment discovery';
  if (matchedTools.length) {
    return `${asset.type} is active via ${matchedTools.length} runtime tool${matchedTools.length === 1 ? '' : 's'} (${matchedTools.join(', ')}).`;
  }
  if (asset.type === 'agent') {
    return `${asset.type} is loaded by the running agent identity from ${scope}.`;
  }
  return `${asset.type} exists in ${scope} but was not observed in the current runtime toolset.`;
}

async function collectProjectAssets({ environment, localEnvironmentId, projects, scanProjectAssets, remote }) {
  const projectAssets = [];
  const relevantProjects = (projects || []).filter((project) => project.environment_id === environment?.id);

  for (const project of relevantProjects) {
    if (project.environment_type === 'remote') {
      if (!environment || environment.type !== 'remote') continue;
      let assets = [];
      try {
        assets = await remote.scanRemoteProjectAssets(environment, project.path);
      } catch {
        assets = [];
      }
      for (const asset of assets) {
        projectAssets.push({ asset, project });
      }
      continue;
    }

    const assets = scanProjectAssets(project.path, {
      environmentId: environment?.id || localEnvironmentId,
      environmentType: 'local',
    });
    for (const asset of assets) {
      projectAssets.push({ asset, project });
    }
  }

  return projectAssets;
}

async function checkRunningAgentIntrospection(agent, options = {}) {
  if (!agent?.id) throw new Error('Running agent is required');

  const force = Boolean(options.force);
  if (!force) {
    const cached = introspectionCache.get(agent.id);
    if (cached && Date.now() - cached.checkedAt <= CACHE_TTL_MS) {
      return finalizeIntrospection(agent, {
        ...cached.result,
        cached: true,
        stale: false,
      });
    }
  }

  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 10000;
  const environments = options.environments || [];
  const projects = options.projects || [];
  const localEnvironmentId = options.localEnvironmentId || null;
  const environment = matchEnvironmentForAgent(agent, environments, localEnvironmentId);
  const localAssets = Array.isArray(options.localAssets) ? options.localAssets : [];
  const storedAssets = Array.isArray(options.storedAssets) ? options.storedAssets : [];
  const baseAssets = environment?.type === 'remote'
    ? storedAssets.filter((asset) => asset.environment_id === environment.id)
    : localAssets;
  const projectAssets = await collectProjectAssets({
    environment,
    localEnvironmentId,
    projects,
    scanProjectAssets: options.scanProjectAssets,
    remote: options.remote,
  });
  const candidates = mergeAssetCandidates(baseAssets, projectAssets, environment?.id || localEnvironmentId);

  let runtime;
  if ((agent.protocol || 'mcp') !== 'mcp') {
    runtime = {
      status: 'warning',
      reachable: false,
      summary: 'This running agent protocol does not support MCP introspection yet.',
      details: ['Only MCP-compatible endpoints can currently be inspected for loaded assets and active tools.'],
      checkedAt: new Date().toISOString(),
      durationMs: 0,
      toolCount: 0,
      tools: [],
    };
  } else {
    runtime = await mcpClient.runMcpDiagnostics({
      url: agent.url,
      headers: agent.headers || {},
    }, { timeoutMs });
  }

  const activeAssetIds = new Set();
  const activeAssetTools = new Map();
  const activeTools = (runtime.tools || []).map((tool) => {
    const matchedAssetIds = candidates
      .filter((asset) => normalizeName(asset.name) === normalizeName(tool.name))
      .map((asset) => asset.id);

    for (const assetId of matchedAssetIds) {
      activeAssetIds.add(assetId);
      const tools = activeAssetTools.get(assetId) || [];
      tools.push(tool.name);
      activeAssetTools.set(assetId, tools);
    }

    return {
      name: tool.name,
      description: tool.description || '',
      matchedAssetIds,
      state: matchedAssetIds.length ? 'matched' : 'unmatched',
    };
  });

  const loadedAssetIds = new Set(
    candidates
      .filter((asset) => asset.type === 'agent' && normalizeName(asset.name) === normalizeName(agent.name))
      .map((asset) => asset.id)
  );

  for (const activeId of activeAssetIds) {
    loadedAssetIds.delete(activeId);
  }

  const assets = candidates.map((asset) => {
    const matchedTools = activeAssetTools.get(asset.id) || [];
    let state = 'configured';
    if (activeAssetIds.has(asset.id)) state = 'active';
    else if (loadedAssetIds.has(asset.id)) state = 'loaded';

    return {
      assetId: asset.id,
      name: asset.name,
      type: asset.type,
      state,
      matchedTools,
      environmentId: asset.environmentId || null,
      projectId: asset.projectId || null,
      projectName: asset.projectName || null,
      projectPath: asset.projectPath || null,
      filePath: asset.filePath || null,
      detail: assetDetail(asset, matchedTools),
    };
  });

  const activeCount = assets.filter((asset) => asset.state === 'active').length;
  const loadedCount = assets.filter((asset) => asset.state === 'loaded').length;
  const configuredCount = assets.filter((asset) => asset.state === 'configured').length;
  const unmatchedToolCount = activeTools.filter((tool) => tool.state === 'unmatched').length;

  const detailLines = [
    environment
      ? `Matched environment: ${environment.name} (${environment.type}).`
      : 'No matching environment found for this running agent; configured assets may be incomplete.',
    runtime.summary,
  ];

  if (runtime.status === 'ok') {
    detailLines.push(
      activeCount
        ? `${activeCount} discovered assets are active in the runtime and map to ${runtime.toolCount || activeTools.length} exposed tool${(runtime.toolCount || activeTools.length) === 1 ? '' : 's'}.`
        : `No discovered assets mapped to the ${runtime.toolCount || activeTools.length} active runtime tool${(runtime.toolCount || activeTools.length) === 1 ? '' : 's'}.`
    );
  }

  if (configuredCount) {
    detailLines.push(`${configuredCount} discovered assets exist only in files and were not observed in the runtime probe.`);
  }

  const summary = runtime.status === 'ok'
    ? `Runtime exposes ${runtime.toolCount || activeTools.length} tools, mapped to ${activeCount} active assets and ${loadedCount} loaded asset${loadedCount === 1 ? '' : 's'}.`
    : `${runtime.summary} ${configuredCount ? `${configuredCount} discovered assets remain file-only.` : ''}`.trim();

  const result = finalizeIntrospection(agent, {
    status: runtime.status,
    reachable: runtime.reachable,
    summary,
    details: [...detailLines, ...(runtime.details || [])].filter(Boolean),
    checkedAt: runtime.checkedAt || new Date().toISOString(),
    durationMs: runtime.durationMs || null,
    toolCount: runtime.toolCount != null ? runtime.toolCount : activeTools.length,
    configuredCount,
    loadedCount,
    activeCount,
    activeToolCount: activeTools.length,
    unmatchedToolCount,
    cached: false,
    stale: false,
    assets,
    activeTools,
  });

  introspectionCache.set(agent.id, {
    checkedAt: Date.now(),
    result,
  });

  return result;
}

module.exports = {
  getCachedIntrospection,
  checkRunningAgentIntrospection,
  clearCachedIntrospection,
};
