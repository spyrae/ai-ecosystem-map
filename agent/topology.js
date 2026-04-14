'use strict';

const { ALL_TOOLS } = require('./connector');

const PROVIDER_LABELS = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  copilot: 'GitHub Copilot',
  continue_dev: 'Continue',
};

function buildTopology({
  localAssets = [],
  storedAssets = [],
  environments = [],
  projects = [],
  runningAgents = [],
  localEnvironmentId = null,
}) {
  const nodes = [];
  const edges = [];
  const nodeMap = new Map();
  const edgeMap = new Set();

  const normalizedLocalAssets = localAssets.map((asset) => normalizeLocalAsset(asset, localEnvironmentId));
  const normalizedStoredAssets = storedAssets
    .filter((asset) => asset.environment_id && asset.environment_id !== localEnvironmentId)
    .map(normalizeStoredAsset);
  const assets = dedupeBy([...normalizedLocalAssets, ...normalizedStoredAssets], (asset) => asset.id);

  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const environmentsById = new Map(environments.map((environment) => [environment.id, environment]));

  const addNode = (node) => {
    nodeMap.set(node.id, node);
    nodes.push(node);
    return node;
  };

  const addEdge = (edge) => {
    if (edgeMap.has(edge.id)) return;
    edgeMap.add(edge.id);
    edges.push(edge);
  };

  const ensureAssetNode = (assetLike) => {
    const assetId = assetLike?.id || assetLike?.assetId;
    if (!assetId) return null;
    const assetNodeId = topologyNodeId('asset', assetId);
    if (!nodeMap.has(assetNodeId)) {
      addNode({
        id: assetNodeId,
        kind: 'asset',
        label: assetLike.name || assetId,
        subtitle: assetLike.desc || assetLike.detail || assetLike.filePath || assetLike.projectPath || '',
        assetId,
        assetType: assetLike.type || assetLike.assetType || null,
        environmentId: assetLike.environmentId || assetLike.environment_id || null,
        projectId: assetLike.projectId || null,
        status: assetLike.health?.status || 'ok',
        badges: assetLike.isOrchestrator ? ['orchestrator'] : [],
        summary: {
          warningCount: assetLike.health?.status === 'warning' ? 1 : 0,
          brokenCount: assetLike.health?.status === 'broken' ? 1 : 0,
        },
      });
    }

    const environmentId = assetLike.environmentId || assetLike.environment_id || null;
    if (environmentId && environmentsById.has(environmentId)) {
      const environment = environmentsById.get(environmentId);
      addEdge({
        id: topologyEdgeId('discovered_on', assetNodeId, topologyNodeId(environment.type === 'local' ? 'machine' : 'remote_server', environmentId)),
        kind: 'discovered_on',
        from: assetNodeId,
        to: topologyNodeId(environment.type === 'local' ? 'machine' : 'remote_server', environmentId),
        label: 'discovered on',
      });
    }

    const projectId = assetLike.projectId || null;
    if (projectId && projectsById.has(projectId)) {
      addEdge({
        id: topologyEdgeId('belongs_to_project', assetNodeId, topologyNodeId('project', projectId)),
        kind: 'belongs_to_project',
        from: assetNodeId,
        to: topologyNodeId('project', projectId),
        label: 'belongs to project',
      });
    }

    return assetNodeId;
  };

  for (const environment of environments) {
    addNode({
      id: topologyNodeId(environment.type === 'local' ? 'machine' : 'remote_server', environment.id),
      kind: environment.type === 'local' ? 'machine' : 'remote_server',
      label: environment.name,
      subtitle: environment.type === 'local'
        ? 'Local machine'
        : [environment.ssh_user, environment.ssh_host].filter(Boolean).join('@') + (environment.ssh_port ? `:${environment.ssh_port}` : ''),
      environmentId: environment.id,
      status: environment.is_active === 0 ? 'inactive' : 'active',
      badges: environment.type === 'local' ? ['local'] : ['remote'],
      summary: {},
    });
  }

  const projectProviders = new Map();
  for (const project of projects) {
    const providers = Array.isArray(project.providers) ? project.providers.filter(Boolean) : [];
    projectProviders.set(project.id, new Set(providers));
    addNode({
      id: topologyNodeId('project', project.id),
      kind: 'project',
      label: project.name,
      subtitle: project.path,
      projectId: project.id,
      environmentId: project.environment_id || null,
      status: project.environment_type === 'remote' ? 'remote' : 'local',
      badges: project.environment_type === 'remote' ? ['remote'] : ['local'],
      summary: {
        assetCount: project.assetCount || 0,
        providerCount: providers.length,
        warningCount: 0,
        brokenCount: 0,
      },
    });

    if (project.environment_id) {
      addEdge({
        id: topologyEdgeId('contains_project', topologyNodeId(project.environment_type === 'remote' ? 'remote_server' : 'machine', project.environment_id), topologyNodeId('project', project.id)),
        kind: 'contains_project',
        from: topologyNodeId(project.environment_type === 'remote' ? 'remote_server' : 'machine', project.environment_id),
        to: topologyNodeId('project', project.id),
        label: 'contains project',
      });
    }
  }

  const providersInUse = new Set(ALL_TOOLS);
  for (const asset of assets) {
    for (const provider of asset.providers || []) providersInUse.add(provider);
    for (const entry of asset.capabilities?.providers || []) providersInUse.add(entry.provider);
  }
  for (const project of projects) {
    for (const provider of project.providers || []) providersInUse.add(provider);
  }

  for (const provider of [...providersInUse].filter(Boolean)) {
    addNode({
      id: topologyNodeId('provider', provider),
      kind: 'provider',
      label: PROVIDER_LABELS[provider] || provider,
      provider,
      badges: [],
      summary: {
        assetCount: 0,
        projectCount: 0,
        environmentCount: 0,
        activeCount: 0,
        configuredCount: 0,
        missingCount: 0,
        invalidCount: 0,
      },
    });
  }

  const dependencyIndex = buildDependencyIndex(assets);
  const providerEnvironments = new Map();
  const providerProjects = new Map();

  for (const asset of assets) {
    const assetNodeId = ensureAssetNode({
      ...asset,
      id: asset.id,
      environmentId: asset.environment_id || null,
    });

    if (asset.environment_id && environmentsById.has(asset.environment_id)) {
      addEdge({
        id: topologyEdgeId('discovered_on', assetNodeId, topologyNodeId(environmentsById.get(asset.environment_id).type === 'local' ? 'machine' : 'remote_server', asset.environment_id)),
        kind: 'discovered_on',
        from: assetNodeId,
        to: topologyNodeId(environmentsById.get(asset.environment_id).type === 'local' ? 'machine' : 'remote_server', asset.environment_id),
        label: 'discovered on',
      });
    }

    const relatedProject = findOwningProject(asset, projects);
    if (relatedProject) {
      addEdge({
        id: topologyEdgeId('belongs_to_project', assetNodeId, topologyNodeId('project', relatedProject.id)),
        kind: 'belongs_to_project',
        from: assetNodeId,
        to: topologyNodeId('project', relatedProject.id),
        label: 'belongs to project',
      });

      asset.projectId = relatedProject.id;
      const providerSet = projectProviders.get(relatedProject.id) || new Set();
      for (const provider of asset.providers || []) providerSet.add(provider);
      projectProviders.set(relatedProject.id, providerSet);
    }

    const providerEntries = asset.capabilities?.providers?.length
      ? asset.capabilities.providers.map((entry) => ({
          provider: entry.provider,
          state: entry.state,
          installed: entry.installed,
          supported: entry.supported,
        }))
      : (asset.providers || []).map((provider) => ({
          provider,
          state: 'available',
          installed: true,
          supported: true,
        }));

    for (const entry of providerEntries) {
      if (!entry.provider) continue;
      const providerNodeId = topologyNodeId('provider', entry.provider);
      addEdge({
        id: topologyEdgeId('targets_provider', assetNodeId, providerNodeId, entry.state),
        kind: 'targets_provider',
        from: assetNodeId,
        to: providerNodeId,
        label: entry.state,
        state: entry.state,
      });

      if (asset.environment_id) {
        if (!providerEnvironments.has(entry.provider)) providerEnvironments.set(entry.provider, new Set());
        providerEnvironments.get(entry.provider).add(asset.environment_id);
      }
      if (asset.projectId) {
        if (!providerProjects.has(entry.provider)) providerProjects.set(entry.provider, new Set());
        providerProjects.get(entry.provider).add(asset.projectId);
      }
    }

    for (const dep of asset.deps || []) {
      const targets = dependencyIndex.get(asset.environment_id || localEnvironmentId, dep)
        || dependencyIndex.get('__global__', dep)
        || [];
      for (const target of targets) {
        if (target.id === asset.id) continue;
        addEdge({
          id: topologyEdgeId('depends_on', assetNodeId, topologyNodeId('asset', target.id), dep),
          kind: 'depends_on',
          from: assetNodeId,
          to: topologyNodeId('asset', target.id),
          label: dep,
        });
      }
    }
  }

  for (const agent of runningAgents) {
    const environment = matchEnvironmentForAgent(agent, environments, localEnvironmentId);
    const agentNodeId = topologyNodeId('running_agent', agent.id);
    const introspection = agent.introspection || null;
    const activeCount = introspection?.activeCount || 0;
    const loadedCount = introspection?.loadedCount || 0;
    const configuredCount = introspection?.configuredCount || 0;
    addNode({
      id: agentNodeId,
      kind: 'running_agent',
      label: agent.name,
      subtitle: agent.url,
      environmentId: environment?.id || null,
      status: introspection?.status || (agent.is_active === 0 ? 'inactive' : 'active'),
      badges: [
        agent.protocol || 'mcp',
        introspection?.status === 'ok' ? 'introspected' : null,
      ].filter(Boolean),
      summary: {
        activeCount,
        configuredCount,
        warningCount: introspection?.status === 'warning' ? 1 : 0,
        brokenCount: introspection?.status === 'broken' ? 1 : 0,
        relatedCount: introspection?.toolCount || 0,
        assetCount: activeCount + loadedCount + configuredCount,
      },
    });

    if (environment) {
      addEdge({
        id: topologyEdgeId('runs_on', agentNodeId, topologyNodeId(environment.type === 'local' ? 'machine' : 'remote_server', environment.id)),
        kind: 'runs_on',
        from: agentNodeId,
        to: topologyNodeId(environment.type === 'local' ? 'machine' : 'remote_server', environment.id),
        label: 'runs on',
      });
    }

    const introspectedAssets = Array.isArray(introspection?.assets) ? introspection.assets : [];
    for (const runtimeAsset of introspectedAssets) {
      if (!['loaded', 'active'].includes(runtimeAsset.state)) continue;
      const assetNodeId = ensureAssetNode(runtimeAsset);
      if (!assetNodeId) continue;
      addEdge({
        id: topologyEdgeId('loaded_by', assetNodeId, agentNodeId, runtimeAsset.state),
        kind: 'loaded_by',
        from: assetNodeId,
        to: agentNodeId,
        label: runtimeAsset.state,
      });
    }
  }

  applyNodeSummaries({
    nodes,
    edges,
    nodeMap,
    projectsById,
    projectProviders,
    providerEnvironments,
    providerProjects,
  });

  return {
    nodes,
    edges,
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      machineCount: nodes.filter((node) => node.kind === 'machine').length,
      remoteServerCount: nodes.filter((node) => node.kind === 'remote_server').length,
      providerCount: nodes.filter((node) => node.kind === 'provider').length,
      projectCount: nodes.filter((node) => node.kind === 'project').length,
      runningAgentCount: nodes.filter((node) => node.kind === 'running_agent').length,
      assetCount: nodes.filter((node) => node.kind === 'asset').length,
    },
  };
}

function normalizeLocalAsset(asset, localEnvironmentId) {
  return {
    ...asset,
    environment_id: asset.environment_id || localEnvironmentId,
  };
}

function normalizeStoredAsset(asset) {
  return {
    ...asset,
    desc: asset.desc || '',
    filePath: asset.filePath || asset.file_path || '',
    providers: Array.isArray(asset.providers) ? asset.providers : [],
    deps: Array.isArray(asset.deps) ? asset.deps : [],
    capabilities: asset.capabilities || null,
    health: asset.health || null,
  };
}

function dedupeBy(items, keyFn) {
  const seen = new Map();
  for (const item of items) {
    seen.set(keyFn(item), item);
  }
  return [...seen.values()];
}

function topologyNodeId(kind, value) {
  return `${kind}:${value}`;
}

function topologyEdgeId(kind, from, to, suffix = '') {
  return `${kind}:${from}:${to}${suffix ? `:${suffix}` : ''}`;
}

function findOwningProject(asset, projects) {
  if (!asset.filePath) return null;
  const candidates = projects.filter((project) => {
    if (asset.environment_id && project.environment_id && asset.environment_id !== project.environment_id) return false;
    return asset.filePath === project.path || asset.filePath.startsWith(`${project.path}/`);
  });
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.path.length - a.path.length)[0];
}

function buildDependencyIndex(assets) {
  const byEnvAndName = new Map();
  const add = (envId, name, asset) => {
    const key = `${envId || '__global__'}::${name}`;
    const current = byEnvAndName.get(key) || [];
    current.push(asset);
    byEnvAndName.set(key, current);
  };

  for (const asset of assets) {
    add(asset.environment_id, asset.name, asset);
    add('__global__', asset.name, asset);
  }

  return {
    get(envId, name) {
      return byEnvAndName.get(`${envId || '__global__'}::${name}`) || null;
    },
  };
}

function matchEnvironmentForAgent(agent, environments, localEnvironmentId) {
  let hostname = '';
  try {
    hostname = new URL(agent.url).hostname;
  } catch {
    hostname = '';
  }

  if (!hostname || ['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    return environments.find((environment) => environment.id === localEnvironmentId) || null;
  }

  return environments.find((environment) => environment.type === 'remote' && (
    environment.ssh_host === hostname || environment.name === hostname
  )) || null;
}

function applyNodeSummaries({
  nodes,
  edges,
  nodeMap,
  projectsById,
  projectProviders,
  providerEnvironments,
  providerProjects,
}) {
  const relatedCounts = new Map();
  for (const edge of edges) {
    relatedCounts.set(edge.from, (relatedCounts.get(edge.from) || 0) + 1);
    relatedCounts.set(edge.to, (relatedCounts.get(edge.to) || 0) + 1);
  }

  for (const node of nodes) {
    const summary = node.summary || {};
    summary.relatedCount = relatedCounts.get(node.id) || 0;

    if (node.kind === 'project') {
      const providerSet = projectProviders.get(node.projectId) || new Set();
      summary.providerCount = providerSet.size;
      summary.projectCount = 1;
    }

    if (node.kind === 'provider') {
      const provider = node.provider;
      const providerEdges = edges.filter((edge) => edge.to === node.id && edge.kind === 'targets_provider');
      summary.assetCount = providerEdges.length;
      summary.projectCount = (providerProjects.get(provider) || new Set()).size;
      summary.environmentCount = (providerEnvironments.get(provider) || new Set()).size;
      summary.activeCount = providerEdges.filter((edge) => edge.state === 'active').length;
      summary.configuredCount = providerEdges.filter((edge) => edge.state === 'configured').length;
      summary.missingCount = providerEdges.filter((edge) => edge.state === 'missing').length;
      summary.invalidCount = providerEdges.filter((edge) => edge.state === 'invalid').length;
    }

    if (node.kind === 'machine' || node.kind === 'remote_server') {
      const environmentId = node.environmentId;
      summary.projectCount = edges.filter((edge) => edge.kind === 'contains_project' && edge.from === node.id).length;
      summary.assetCount = edges.filter((edge) => edge.kind === 'discovered_on' && edge.to === node.id).length;
      summary.agentCount = edges.filter((edge) => edge.kind === 'runs_on' && edge.to === node.id).length;
      summary.providerCount = [...providerEnvironments.values()].filter((set) => set.has(environmentId)).length;
    }

    if (node.kind === 'running_agent') {
      summary.projectCount = summary.projectCount || 0;
      summary.providerCount = summary.providerCount || 0;
    }

    if (node.kind === 'asset') {
      const outgoingProviders = edges.filter((edge) => edge.from === node.id && edge.kind === 'targets_provider').length;
      const outgoingDeps = edges.filter((edge) => edge.from === node.id && edge.kind === 'depends_on').length;
      const incomingDeps = edges.filter((edge) => edge.to === node.id && edge.kind === 'depends_on').length;
      const runtimeConsumers = edges.filter((edge) => edge.from === node.id && edge.kind === 'loaded_by').length;
      const providerConsumers = edges.filter((edge) =>
        edge.from === node.id
        && edge.kind === 'targets_provider'
        && ['active', 'configured'].includes(edge.state)
      ).length;
      const consumerCount = incomingDeps + runtimeConsumers + providerConsumers;
      summary.providerCount = outgoingProviders;
      summary.dependencyCount = outgoingDeps;
      summary.assetConsumerCount = incomingDeps;
      summary.runtimeConsumerCount = runtimeConsumers;
      summary.providerConsumerCount = providerConsumers;
      summary.consumerCount = consumerCount;
      summary.orphaned = consumerCount === 0;
      summary.projectCount = edges.some((edge) => edge.kind === 'belongs_to_project' && edge.from === node.id) ? 1 : 0;
    }

    node.summary = summary;
    nodeMap.set(node.id, node);
  }

  for (const [projectId, providerSet] of projectProviders.entries()) {
    const projectNode = nodeMap.get(topologyNodeId('project', projectId));
    if (!projectNode) continue;
    projectNode.summary = {
      ...(projectNode.summary || {}),
      providerCount: providerSet.size,
      assetCount: projectNode.summary?.assetCount || projectsById.get(projectId)?.assetCount || 0,
    };
  }
}

module.exports = {
  buildTopology,
  matchEnvironmentForAgent,
};
