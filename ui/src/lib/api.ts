import type {
  Asset,
  ProviderStat,
  Stats,
  HistoryEntry,
  Project,
  ProjectAsset,
  Environment,
  DiffResult,
  McpTool,
  RunningAgent,
  SyncPlan,
  SyncRequest,
  ConnectionInfo,
  BatchActionItem,
  BatchActionResult,
  BatchSyncPreview,
  BatchSyncApplyResult,
  TopologyGraph,
} from '../types';

const BASE = '/api';

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

// Assets
export async function fetchAssets(filters?: {
  type?: string;
  provider?: string;
  category?: string;
  q?: string;
}) {
  const params: Record<string, string> = {};
  if (filters?.type) params.type = filters.type;
  if (filters?.provider) params.provider = filters.provider;
  if (filters?.category) params.category = filters.category;
  if (filters?.q) params.q = filters.q;
  return get<{ ok: boolean; data: Asset[]; total: number }>(`${BASE}/assets`, params);
}

// Connections for an asset
export async function fetchConnections(assetId: string, type: string) {
  return get<Record<string, ConnectionInfo>>(
    `${BASE}/assets/${encodeURIComponent(assetId)}/connections`,
    { type }
  );
}

// Connect / Disconnect
export async function connectAsset(assetId: string, tool: string, type: string) {
  return post<{ ok: boolean; method?: string; error?: string }>('/connect', { assetId, tool, type });
}

export async function disconnectAsset(assetId: string, tool: string, type: string) {
  return post<{ ok: boolean; error?: string }>('/disconnect', { assetId, tool, type });
}

// Stats
export async function fetchStats() {
  return get<{ ok: boolean; data: Stats }>(`${BASE}/stats`);
}

export async function fetchTopology() {
  return get<{ ok: boolean; data: TopologyGraph }>(`${BASE}/topology`);
}

// Providers
export async function fetchProviders() {
  return get<{ ok: boolean; data: ProviderStat[] }>(`${BASE}/providers`);
}

// Categories
export async function fetchCategories() {
  return get<{ ok: boolean; data: Record<string, number> }>(`${BASE}/categories`);
}

// History
export async function fetchHistory(limit = 50) {
  return get<{ ok: boolean; data: HistoryEntry[] }>(`${BASE}/history`, { limit: String(limit) });
}

export async function rollbackHistoryEntry(historyId: number) {
  return post<{ ok: boolean; historyId: number; snapshotId?: string; restored?: number; error?: string }>(
    `/history/${historyId}/rollback`,
    {}
  );
}

export async function undoLastAction() {
  return post<{ ok: boolean; historyId: number; snapshotId?: string; restored?: number; error?: string }>(
    '/undo',
    {}
  );
}

// Rescan
export async function rescan() {
  return post<{ ok: boolean; count: number }>('/rescan', {});
}

// Projects
export async function fetchProjects() {
  return get<{ ok: boolean; data: Project[] }>(`${BASE}/projects`);
}

export async function discoverProjects(dirs: string[]) {
  return post<{ ok: boolean; data: Project[] }>('/projects/discover', { dirs });
}

export async function addProject(projectPath: string) {
  return post<{ ok: boolean; data: Project }>('/projects/add', { path: projectPath });
}

export async function fetchProjectAssets(projectPath: string) {
  return get<{ ok: boolean; data: ProjectAsset[]; total: number }>(
    `${BASE}/projects/${encodeURIComponent(projectPath)}/assets`
  );
}

export async function fetchProjectAssetsById(projectId: string) {
  return get<{ ok: boolean; data: ProjectAsset[]; total: number }>(
    `${BASE}/projects/${encodeURIComponent(projectId)}/assets-by-id`
  );
}

// Move/Copy
export async function moveAsset(data: {
  assetId?: string;
  sourcePath?: string;
  name: string;
  type: string;
  targetProjectPath: string;
  method: 'symlink' | 'copy';
  provider?: string;
  config?: Record<string, unknown>;
}) {
  return post<{ ok: boolean; targetPath?: string; method?: string; error?: string }>('/assets/move', data);
}

// CRUD
export async function fetchAssetContent(assetId: string, type?: string) {
  return get<{ ok: boolean; content: string; filePath: string }>(
    `${BASE}/assets/${encodeURIComponent(assetId)}/content`,
    type ? { type } : undefined
  );
}

export async function updateAssetContent(assetId: string, content: string, type?: string) {
  const res = await fetch(`${BASE}/assets/${encodeURIComponent(assetId)}/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, type }),
  });
  return res.json();
}

export async function createAsset(data: {
  name: string;
  type: string;
  content?: string;
  provider?: string;
  scope?: string;
  config?: Record<string, unknown>;
}) {
  return post<{ ok: boolean; filePath?: string; error?: string }>('/assets/create', data);
}

export async function generateAsset(type: string, name: string, description: string) {
  return post<{ ok: boolean; content?: string; error?: string }>('/generate', { type, name, description });
}

export async function deleteAsset(assetId: string, type: string) {
  const res = await fetch(`${BASE}/assets/${encodeURIComponent(assetId)}?type=${type}`, {
    method: 'DELETE',
  });
  return res.json();
}

// MCP inspection
export async function fetchMcpConfig(assetId: string) {
  return get<{ ok: boolean; config: Record<string, unknown>; source: string }>(
    `${BASE}/mcp/${encodeURIComponent(assetId)}/config`
  );
}

export async function listMcpTools(assetId: string) {
  return post<{ ok: boolean; tools?: McpTool[]; count?: number; error?: string }>(
    `/mcp/${encodeURIComponent(assetId)}/tools`, {}
  );
}

// Running agents
export async function fetchRunningAgents() {
  return get<{ ok: boolean; data: RunningAgent[] }>(`${BASE}/running-agents`);
}

export async function addRunningAgent(agent: { name: string; url: string; description?: string; protocol?: string }) {
  return post<{ ok: boolean; id: string }>('/running-agents/add', agent);
}

export async function removeRunningAgent(id: string) {
  const res = await fetch(`${BASE}/running-agents/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function listAgentTools(id: string) {
  return post<{ ok: boolean; tools?: McpTool[]; count?: number; error?: string }>(
    `/running-agents/${id}/tools`, {}
  );
}

// Servers
export async function fetchServers() {
  return get<{ ok: boolean; data: Environment[] }>(`${BASE}/servers`);
}

export async function addServer(server: {
  name: string;
  ssh_host: string;
  ssh_user: string;
  ssh_port?: number;
  ssh_key_path?: string;
}) {
  return post<{ ok: boolean; id: string }>('/servers/add', server);
}

export async function testServer(id: string) {
  return post<{ ok: boolean; hostname?: string; error?: string }>(`/servers/${id}/test`, {});
}

export async function scanServer(id: string) {
  return post<{ ok: boolean; data: unknown[]; count: number }>(`/servers/${id}/scan`, {});
}

export async function discoverRemoteProjects(id: string, dirs: string[] = []) {
  return post<{ ok: boolean; data: Project[]; count: number }>(`/servers/${id}/projects/discover`, { dirs });
}

export async function diffServer(id: string) {
  return get<{ ok: boolean; data: DiffResult }>(`${BASE}/servers/${id}/diff`);
}

export async function pushToServer(id: string, assetId: string, name: string, type: string) {
  return post<{ ok: boolean; remotePath?: string; error?: string }>(`/servers/${id}/push`, { assetId, name, type });
}

export async function pullFromServer(id: string, assetId: string, name: string, remotePath: string | undefined, type: string) {
  return post<{ ok: boolean; localPath?: string; error?: string }>(`/servers/${id}/pull`, { assetId, name, remotePath, type });
}

// Sync engine
export async function previewSync(request: SyncRequest) {
  return post<{ ok: boolean; plan: SyncPlan; error?: string }>('/sync/preview', request);
}

export async function applySync(request: SyncRequest) {
  return post<{ ok: boolean; plan: SyncPlan; applied?: number; skipped?: number; error?: string }>('/sync/apply', request);
}

// Batch operations
export async function validateBatch(items: BatchActionItem[]) {
  return post<BatchActionResult>('/batch/validate', { items });
}

export async function connectBatch(items: BatchActionItem[], tool: string) {
  return post<BatchActionResult>('/batch/connect', { items, tool });
}

export async function disconnectBatch(items: BatchActionItem[], tool: string) {
  return post<BatchActionResult>('/batch/disconnect', { items, tool });
}

export async function deleteBatch(items: BatchActionItem[]) {
  return post<BatchActionResult>('/batch/delete', { items });
}

export async function previewBatchSync(requests: SyncRequest[]) {
  return post<BatchSyncPreview>('/batch/sync/preview', { requests });
}

export async function applyBatchSync(requests: SyncRequest[]) {
  return post<BatchSyncApplyResult>('/batch/sync/apply', { requests });
}
