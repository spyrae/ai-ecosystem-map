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
  McpRuntimeCheck,
  RunningAgent,
  RunningAgentIntrospection,
  AuditMode,
  AuditReport,
  SyncPlan,
  SyncRequest,
  ConnectionInfo,
  DriftGraph,
  BatchActionItem,
  BatchActionResult,
  BatchSyncPreview,
  BatchSyncApplyResult,
  TopologyGraph,
  DependencyGraph,
  Bundle,
  BundleApplyData,
  BundlePreviewData,
  BundleTarget,
  WorkspaceManifest,
  WorkspaceManifestExportOptions,
  WorkspaceManifestImportApplyData,
  WorkspaceManifestImportPreviewData,
  Policy,
  PolicyEvaluation,
  RemediationSuggestion,
} from '../types';

const BASE = '/api';

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      'X-AEM-Client': 'web',
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AEM-Client': 'web',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-AEM-Client': 'web',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: {
      'X-AEM-Client': 'web',
    },
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

export async function fetchDrift() {
  return get<{ ok: boolean; data: DriftGraph }>(`${BASE}/drift`);
}

export async function fetchAuditMode() {
  return get<{ ok: boolean; data: AuditMode }>(`${BASE}/audit-mode`);
}

export async function setGlobalReadOnly(readOnly: boolean) {
  return post<{ ok: boolean; data: AuditMode; error?: string }>('/audit-mode/global', { readOnly });
}

export async function setServerReadOnly(serverId: string, readOnly: boolean) {
  return post<{ ok: boolean; data: AuditMode; error?: string }>(`/servers/${serverId}/read-only`, { readOnly });
}

export async function fetchAuditReport() {
  return get<{ ok: boolean; data: AuditReport }>(`${BASE}/audit/report`);
}

export async function setSourceOfTruth(groupKey: string, assetId: string) {
  return post<{ ok: boolean; groupKey: string; assetId: string }>('/drift/source-truth', { groupKey, assetId });
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

export async function rollbackHistoryEntry(historyId: number, approval?: { confirmed: boolean; note?: string | null; source?: string | null }) {
  return post<{ ok: boolean; historyId: number; snapshotId?: string; restored?: number; error?: string }>(
    `/history/${historyId}/rollback`,
    { approval }
  );
}

export async function undoLastAction(approval?: { confirmed: boolean; note?: string | null; source?: string | null }) {
  return post<{ ok: boolean; historyId: number; snapshotId?: string; restored?: number; error?: string }>(
    '/undo',
    { approval }
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

export async function updateProject(projectId: string, data: { project_type?: string | null }) {
  return put<{ ok: boolean; data: Project }>(`/projects/${encodeURIComponent(projectId)}`, data);
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
    headers: {
      'Content-Type': 'application/json',
      'X-AEM-Client': 'web',
    },
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
    headers: {
      'X-AEM-Client': 'web',
    },
  });
  return res.json();
}

export async function fetchDependencies() {
  return get<{ ok: boolean; data: DependencyGraph }>(`${BASE}/dependencies`);
}

export async function fetchAssetRemediations(assetId: string, type?: string) {
  return get<{ ok: boolean; data: RemediationSuggestion[] }>(
    `${BASE}/assets/${encodeURIComponent(assetId)}/remediations`,
    type ? { type } : undefined
  );
}

export async function applyAssetRemediation(assetId: string, remediationId: string, options?: { type?: string; confirmRisk?: boolean; approval?: { confirmed: boolean; note?: string | null; source?: string | null } }) {
  return post<{ ok: boolean; data?: unknown; error?: string }>(
    `/assets/${encodeURIComponent(assetId)}/remediations/${encodeURIComponent(remediationId)}/apply`,
    { type: options?.type, confirmRisk: options?.confirmRisk ?? false, approval: options?.approval }
  );
}

export async function fetchProjectRemediations(projectId: string) {
  return get<{ ok: boolean; data: RemediationSuggestion[] }>(
    `${BASE}/projects/${encodeURIComponent(projectId)}/remediations`
  );
}

export async function applyProjectRemediation(projectId: string, remediationId: string, options?: { confirmRisk?: boolean; approval?: { confirmed: boolean; note?: string | null; source?: string | null } }) {
  return post<{ ok: boolean; data?: unknown; error?: string }>(
    `/projects/${encodeURIComponent(projectId)}/remediations/${encodeURIComponent(remediationId)}/apply`,
    { confirmRisk: options?.confirmRisk ?? false, approval: options?.approval }
  );
}

export async function fetchServerRemediations(serverId: string) {
  return get<{ ok: boolean; data: RemediationSuggestion[] }>(
    `${BASE}/servers/${encodeURIComponent(serverId)}/remediations`
  );
}

export async function applyServerRemediation(serverId: string, remediationId: string, options?: { confirmRisk?: boolean; approval?: { confirmed: boolean; note?: string | null; source?: string | null } }) {
  return post<{ ok: boolean; data?: unknown; error?: string }>(
    `/servers/${encodeURIComponent(serverId)}/remediations/${encodeURIComponent(remediationId)}/apply`,
    { confirmRisk: options?.confirmRisk ?? false, approval: options?.approval }
  );
}

// MCP inspection
export async function fetchMcpConfig(assetId: string) {
  return get<{ ok: boolean; config: Record<string, unknown>; source: string }>(
    `${BASE}/mcp/${encodeURIComponent(assetId)}/config`
  );
}

export async function fetchMcpRuntime(assetId: string) {
  return get<{ ok: boolean; data: McpRuntimeCheck }>(
    `${BASE}/mcp/${encodeURIComponent(assetId)}/runtime`
  );
}

export async function runMcpRuntimeCheck(assetId: string, options?: { force?: boolean; timeoutMs?: number }) {
  return post<{ ok: boolean; data: McpRuntimeCheck }>(
    `/mcp/${encodeURIComponent(assetId)}/runtime`,
    options || {}
  );
}

export async function listMcpTools(assetId: string) {
  return post<{ ok: boolean; tools?: McpTool[]; count?: number; error?: string; runtime?: McpRuntimeCheck }>(
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
  const res = await fetch(`${BASE}/running-agents/${id}`, {
    method: 'DELETE',
    headers: {
      'X-AEM-Client': 'web',
    },
  });
  return res.json();
}

export async function fetchRunningAgentIntrospection(id: string) {
  return get<{ ok: boolean; data: RunningAgentIntrospection }>(
    `${BASE}/running-agents/${encodeURIComponent(id)}/introspection`
  );
}

export async function runRunningAgentIntrospection(id: string, options?: { force?: boolean; timeoutMs?: number }) {
  return post<{ ok: boolean; data: RunningAgentIntrospection; error?: string }>(
    `/running-agents/${encodeURIComponent(id)}/introspection`,
    { force: options?.force ?? true, timeoutMs: options?.timeoutMs }
  );
}

export async function listAgentTools(id: string) {
  return post<{ ok: boolean; tools?: McpTool[]; count?: number; error?: string; introspection?: RunningAgentIntrospection }>(
    `/running-agents/${id}/tools`,
    { force: true }
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

export async function applySync(request: SyncRequest, approval?: { confirmed: boolean; note?: string | null; source?: string | null }) {
  return post<{ ok: boolean; plan: SyncPlan; applied?: number; skipped?: number; error?: string; approvalRequired?: boolean }>('/sync/apply', {
    ...request,
    approval,
  });
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

export async function deleteBatch(items: BatchActionItem[], approval?: { confirmed: boolean; note?: string | null; source?: string | null }) {
  return post<BatchActionResult>('/batch/delete', { items, approval });
}

export async function previewBatchSync(requests: SyncRequest[]) {
  return post<BatchSyncPreview>('/batch/sync/preview', { requests });
}

export async function applyBatchSync(requests: SyncRequest[], approval?: { confirmed: boolean; note?: string | null; source?: string | null }) {
  return post<BatchSyncApplyResult>('/batch/sync/apply', { requests, approval });
}

// Bundles
export async function fetchBundles() {
  return get<{ ok: boolean; data: Bundle[] }>(`${BASE}/bundles`);
}

export async function fetchBundle(bundleId: string) {
  return get<{ ok: boolean; data: Bundle }>(`${BASE}/bundles/${encodeURIComponent(bundleId)}`);
}

export async function createBundle(data: {
  name: string;
  description?: string;
  versionLabel?: string;
  items: Bundle['items'];
}) {
  return post<{ ok: boolean; data: Bundle; error?: string }>('/bundles', data);
}

export async function updateBundle(bundleId: string, data: {
  name?: string;
  description?: string;
  versionLabel?: string;
  items?: Bundle['items'];
}) {
  const res = await fetch(`${BASE}/bundles/${encodeURIComponent(bundleId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-AEM-Client': 'web',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json() as Promise<{ ok: boolean; data: Bundle; error?: string }>;
}

export async function deleteBundle(bundleId: string) {
  return del<{ ok: boolean; id: string; error?: string }>(`/bundles/${encodeURIComponent(bundleId)}`);
}

export async function previewBundle(bundleId: string, target: BundleTarget) {
  return post<{ ok: boolean; data: BundlePreviewData; error?: string }>(`/bundles/${encodeURIComponent(bundleId)}/preview`, { target });
}

export async function applyBundle(bundleId: string, target: BundleTarget) {
  return post<{ ok: boolean; data: BundleApplyData; error?: string }>(`/bundles/${encodeURIComponent(bundleId)}/apply`, { target });
}

// Workspace manifest
export async function exportWorkspaceManifest(selection: WorkspaceManifestExportOptions) {
  return post<{ ok: boolean; data: WorkspaceManifest; error?: string }>('/manifest/export', selection);
}

export async function previewImportManifest(manifest: WorkspaceManifest) {
  return post<{ ok: boolean; data: WorkspaceManifestImportPreviewData; error?: string }>('/manifest/preview-import', { manifest });
}

export async function applyImportManifest(
  manifest: WorkspaceManifest,
  approval?: { confirmed: boolean; note?: string | null; source?: string | null }
) {
  return post<{ ok: boolean; data: WorkspaceManifestImportApplyData; error?: string }>('/manifest/apply-import', {
    manifest,
    approval,
  });
}

// Policies
export async function fetchPolicies() {
  return get<{ ok: boolean; data: Policy[] }>(`${BASE}/policies`);
}

export async function fetchPolicyEvaluation() {
  return get<{ ok: boolean; data: PolicyEvaluation }>(`${BASE}/policies/evaluate`);
}

export async function createPolicy(data: Omit<Policy, 'id' | 'created_at' | 'updated_at'>) {
  return post<{ ok: boolean; data: Policy; error?: string }>('/policies', data);
}

export async function updatePolicy(policyId: string, data: Partial<Omit<Policy, 'id' | 'created_at' | 'updated_at'>>) {
  return put<{ ok: boolean; data: Policy; error?: string }>(`/policies/${encodeURIComponent(policyId)}`, data);
}

export async function deletePolicy(policyId: string) {
  return del<{ ok: boolean; error?: string }>(`/policies/${encodeURIComponent(policyId)}`);
}
