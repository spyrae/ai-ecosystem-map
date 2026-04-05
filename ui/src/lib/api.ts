import type { Asset, ProviderStat, Stats, HistoryEntry, Project, ProjectAsset, Environment, DiffResult, McpTool, RunningAgent } from '../types';

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
export async function fetchConnections(name: string, type: string) {
  return get<Record<string, { connected: boolean; method?: string }>>(
    `${BASE}/assets/${encodeURIComponent(name)}/connections`,
    { type }
  );
}

// Connect / Disconnect
export async function connectAsset(name: string, tool: string, type: string) {
  return post<{ ok: boolean; method?: string; error?: string }>('/connect', { name, tool, type });
}

export async function disconnectAsset(name: string, tool: string, type: string) {
  return post<{ ok: boolean; error?: string }>('/disconnect', { name, tool, type });
}

// Stats
export async function fetchStats() {
  return get<{ ok: boolean; data: Stats }>(`${BASE}/stats`);
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

// Move/Copy
export async function moveAsset(data: {
  sourcePath: string;
  name: string;
  type: string;
  targetProjectPath: string;
  method: 'symlink' | 'copy';
}) {
  return post<{ ok: boolean; targetPath?: string; method?: string; error?: string }>('/assets/move', data);
}

// CRUD
export async function fetchAssetContent(name: string) {
  return get<{ ok: boolean; content: string; filePath: string }>(
    `${BASE}/assets/${encodeURIComponent(name)}/content`
  );
}

export async function updateAssetContent(name: string, content: string) {
  const res = await fetch(`${BASE}/assets/${encodeURIComponent(name)}/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
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

export async function deleteAsset(name: string, type: string) {
  const res = await fetch(`${BASE}/assets/${encodeURIComponent(name)}?type=${type}`, {
    method: 'DELETE',
  });
  return res.json();
}

// MCP inspection
export async function fetchMcpConfig(name: string) {
  return get<{ ok: boolean; config: Record<string, unknown>; source: string }>(
    `${BASE}/mcp/${encodeURIComponent(name)}/config`
  );
}

export async function listMcpTools(name: string) {
  return post<{ ok: boolean; tools?: McpTool[]; count?: number; error?: string }>(
    `/mcp/${encodeURIComponent(name)}/tools`, {}
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

export async function diffServer(id: string) {
  return get<{ ok: boolean; data: DiffResult }>(`${BASE}/servers/${id}/diff`);
}

export async function pushToServer(id: string, name: string, type: string) {
  return post<{ ok: boolean; remotePath?: string; error?: string }>(`/servers/${id}/push`, { name, type });
}

export async function pullFromServer(id: string, remotePath: string, type: string) {
  return post<{ ok: boolean; localPath?: string; error?: string }>(`/servers/${id}/pull`, { remotePath, type });
}
