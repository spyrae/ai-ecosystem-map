'use strict';

function buildDependencyGraph(topology) {
  const graph = {
    byAssetId: {},
    orphanedAssetIds: [],
    summary: {
      assetCount: 0,
      orphanedCount: 0,
      usedCount: 0,
      dependencyEdgeCount: 0,
      assetConsumerCount: 0,
      runtimeConsumerCount: 0,
      providerConsumerCount: 0,
    },
  };

  if (!topology?.nodes?.length) return graph;

  const nodesById = new Map(topology.nodes.map((node) => [node.id, node]));
  const assetNodes = topology.nodes.filter((node) => node.kind === 'asset');

  const ensureInfo = (assetNode) => {
    const assetId = assetNode.assetId;
    if (!assetId) return null;
    if (!graph.byAssetId[assetId]) {
      graph.byAssetId[assetId] = {
        assetId,
        name: assetNode.label,
        type: assetNode.assetType || null,
        dependencyCount: 0,
        consumerCount: 0,
        assetConsumerCount: 0,
        runtimeConsumerCount: 0,
        providerConsumerCount: 0,
        orphaned: false,
        summary: 'No downstream consumers detected.',
        dependsOn: [],
        dependedOnBy: [],
        runtimeConsumers: [],
        providerConsumers: [],
      };
    }
    return graph.byAssetId[assetId];
  };

  const pushUnique = (list, item, key = 'id') => {
    if (!item?.[key]) return;
    if (list.some((entry) => entry[key] === item[key])) return;
    list.push(item);
  };

  for (const assetNode of assetNodes) {
    ensureInfo(assetNode);
  }

  for (const edge of topology.edges || []) {
    const fromNode = nodesById.get(edge.from);
    const toNode = nodesById.get(edge.to);
    if (!fromNode || !toNode) continue;

    if (edge.kind === 'depends_on' && fromNode.kind === 'asset' && toNode.kind === 'asset') {
      const source = ensureInfo(fromNode);
      const target = ensureInfo(toNode);
      if (!source || !target) continue;
      pushUnique(source.dependsOn, {
        id: toNode.assetId,
        name: toNode.label,
        type: toNode.assetType || null,
      });
      pushUnique(target.dependedOnBy, {
        id: fromNode.assetId,
        name: fromNode.label,
        type: fromNode.assetType || null,
      });
      graph.summary.dependencyEdgeCount += 1;
      continue;
    }

    if (edge.kind === 'loaded_by' && fromNode.kind === 'asset' && toNode.kind === 'running_agent') {
      const source = ensureInfo(fromNode);
      if (!source) continue;
      pushUnique(source.runtimeConsumers, {
        id: toNode.id,
        name: toNode.label,
        state: edge.label || 'loaded',
      });
      continue;
    }

    if (edge.kind === 'targets_provider' && fromNode.kind === 'asset' && toNode.kind === 'provider') {
      const source = ensureInfo(fromNode);
      if (!source) continue;
      if (!['active', 'configured'].includes(edge.state)) continue;
      pushUnique(source.providerConsumers, {
        id: toNode.id,
        name: toNode.label,
        state: edge.state,
      });
    }
  }

  for (const assetNode of assetNodes) {
    const info = ensureInfo(assetNode);
    if (!info) continue;

    info.dependencyCount = info.dependsOn.length;
    info.assetConsumerCount = info.dependedOnBy.length;
    info.runtimeConsumerCount = info.runtimeConsumers.length;
    info.providerConsumerCount = info.providerConsumers.length;
    info.consumerCount = info.assetConsumerCount + info.runtimeConsumerCount + info.providerConsumerCount;
    info.orphaned = info.consumerCount === 0;

    if (info.orphaned) {
      info.summary = 'This asset has no active provider, runtime, or reverse dependency consumers.';
      graph.orphanedAssetIds.push(info.assetId);
      graph.summary.orphanedCount += 1;
    } else {
      const parts = [];
      if (info.assetConsumerCount) parts.push(`${info.assetConsumerCount} asset dependenc${info.assetConsumerCount === 1 ? 'y' : 'ies'}`);
      if (info.runtimeConsumerCount) parts.push(`${info.runtimeConsumerCount} running agent${info.runtimeConsumerCount === 1 ? '' : 's'}`);
      if (info.providerConsumerCount) parts.push(`${info.providerConsumerCount} provider connection${info.providerConsumerCount === 1 ? '' : 's'}`);
      info.summary = `Used by ${parts.join(', ')}.`;
      graph.summary.usedCount += 1;
    }

    graph.summary.assetConsumerCount += info.assetConsumerCount;
    graph.summary.runtimeConsumerCount += info.runtimeConsumerCount;
    graph.summary.providerConsumerCount += info.providerConsumerCount;
  }

  graph.summary.assetCount = assetNodes.length;
  return graph;
}

module.exports = {
  buildDependencyGraph,
};
