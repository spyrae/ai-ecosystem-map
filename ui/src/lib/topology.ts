import type { TopologyEdge, TopologyGraph, TopologyNode, TopologyNodeKind } from '../types';

export function topologyEntityId(kind: TopologyNodeKind, value: string) {
  return `${kind}:${value}`;
}

export function indexTopology(topology?: TopologyGraph | null) {
  const nodesById = new Map<string, TopologyNode>();
  const edgesByFrom = new Map<string, TopologyEdge[]>();
  const edgesByTo = new Map<string, TopologyEdge[]>();

  for (const node of topology?.nodes || []) {
    nodesById.set(node.id, node);
  }
  for (const edge of topology?.edges || []) {
    const fromList = edgesByFrom.get(edge.from) || [];
    fromList.push(edge);
    edgesByFrom.set(edge.from, fromList);

    const toList = edgesByTo.get(edge.to) || [];
    toList.push(edge);
    edgesByTo.set(edge.to, toList);
  }

  return { nodesById, edgesByFrom, edgesByTo };
}

export function buildUsedByMapFromTopology(topology?: TopologyGraph | null) {
  const usedByMap: Record<string, string[]> = {};
  if (!topology) return usedByMap;

  const { nodesById } = indexTopology(topology);
  for (const edge of topology.edges) {
    if (edge.kind !== 'depends_on') continue;
    const source = nodesById.get(edge.from);
    const target = nodesById.get(edge.to);
    if (!source || !target) continue;
    if (!usedByMap[target.label]) usedByMap[target.label] = [];
    if (!usedByMap[target.label].includes(source.label)) {
      usedByMap[target.label].push(source.label);
    }
  }
  return usedByMap;
}

export function getAssetTopology(topology: TopologyGraph | null | undefined, assetId: string) {
  if (!topology) {
    return {
      environmentNodes: [] as TopologyNode[],
      projectNodes: [] as TopologyNode[],
      providerLinks: [] as { node: TopologyNode; edge: TopologyEdge }[],
      dependsOn: [] as TopologyNode[],
      dependedOnBy: [] as TopologyNode[],
    };
  }

  const { nodesById, edgesByFrom, edgesByTo } = indexTopology(topology);
  const assetNodeId = topologyEntityId('asset', assetId);

  return {
    environmentNodes: (edgesByFrom.get(assetNodeId) || [])
      .filter((edge) => edge.kind === 'discovered_on')
      .map((edge) => nodesById.get(edge.to))
      .filter(Boolean) as TopologyNode[],
    projectNodes: (edgesByFrom.get(assetNodeId) || [])
      .filter((edge) => edge.kind === 'belongs_to_project')
      .map((edge) => nodesById.get(edge.to))
      .filter(Boolean) as TopologyNode[],
    providerLinks: (edgesByFrom.get(assetNodeId) || [])
      .filter((edge) => edge.kind === 'targets_provider')
      .map((edge) => ({ edge, node: nodesById.get(edge.to) }))
      .filter((item): item is { edge: TopologyEdge; node: TopologyNode } => Boolean(item.node)),
    dependsOn: (edgesByFrom.get(assetNodeId) || [])
      .filter((edge) => edge.kind === 'depends_on')
      .map((edge) => nodesById.get(edge.to))
      .filter(Boolean) as TopologyNode[],
    dependedOnBy: (edgesByTo.get(assetNodeId) || [])
      .filter((edge) => edge.kind === 'depends_on')
      .map((edge) => nodesById.get(edge.from))
      .filter(Boolean) as TopologyNode[],
  };
}

export function getProjectTopologyNode(topology: TopologyGraph | null | undefined, projectId: string) {
  return topology ? indexTopology(topology).nodesById.get(topologyEntityId('project', projectId)) || null : null;
}

export function getEnvironmentTopologyNode(topology: TopologyGraph | null | undefined, environmentId: string, environmentType: 'local' | 'remote' | null | undefined) {
  if (!topology || !environmentId) return null;
  const kind = environmentType === 'remote' ? 'remote_server' : 'machine';
  return indexTopology(topology).nodesById.get(topologyEntityId(kind, environmentId)) || null;
}

export function getRunningAgentTopologyNode(topology: TopologyGraph | null | undefined, agentId: string) {
  return topology ? indexTopology(topology).nodesById.get(topologyEntityId('running_agent', agentId)) || null : null;
}

export function getRunningAgentEnvironmentNode(topology: TopologyGraph | null | undefined, agentId: string) {
  if (!topology) return null;
  const { nodesById, edgesByFrom } = indexTopology(topology);
  const edge = (edgesByFrom.get(topologyEntityId('running_agent', agentId)) || []).find((item) => item.kind === 'runs_on');
  return edge ? nodesById.get(edge.to) || null : null;
}
