export type AssetType = 'skill' | 'agent' | 'mcp' | 'instruction' | 'rule';
export type AssetHealthStatus = 'warning' | 'broken';
export type AssetCapabilityState = 'active' | 'configured' | 'available' | 'missing' | 'unsupported' | 'invalid';

export interface HealthIssue {
  level: 'warning' | 'blocking';
  code: string;
  message: string;
}

export interface AssetHealth {
  status: 'ok' | 'warning' | 'broken';
  issueCount: number;
  hasBlocking: boolean;
  summary: string;
  issues: HealthIssue[];
}

export interface AssetCapabilitySummary {
  total: number;
  active: number;
  configured: number;
  available: number;
  missing: number;
  unsupported: number;
  invalid: number;
}

export interface AssetCapabilityEntry {
  provider: Provider;
  label: string;
  state: AssetCapabilityState;
  installed: boolean;
  supported: boolean;
  connected: boolean;
  isSource: boolean;
  isSymlink: boolean;
  targetPath: string | null;
  detail: string;
}

export interface AssetCapabilities {
  summary: AssetCapabilitySummary;
  providers: AssetCapabilityEntry[];
}

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  desc: string;
  cat: string;
  filePath?: string;
  tags: string[];
  providers: string[];
  keywords: string;
  deps: string[];
  isOrchestrator: boolean;
  hash: string;
  environment_id: string;
  discovered_at: number;
  updated_at: number;
  health?: AssetHealth;
  capabilities?: AssetCapabilities;
}

function hasBlockingHealthIssue(asset: Pick<Asset, 'health'> | null | undefined, codes?: string[]) {
  if (!asset?.health?.issues?.length) return false;
  return asset.health.issues.some((issue) => issue.level === 'blocking' && (!codes || codes.includes(issue.code)));
}

export function assetCanConnect(asset: Asset | null | undefined) {
  if (!asset) return false;
  if (!['skill', 'agent', 'mcp', 'instruction', 'rule'].includes(asset.type)) return false;
  return !hasBlockingHealthIssue(asset);
}

export function assetCanEdit(asset: Asset | null | undefined) {
  if (!asset) return false;
  if (asset.type === 'mcp') {
    return !hasBlockingHealthIssue(asset, ['missing_config', 'missing_path', 'missing_file', 'broken_symlink']);
  }
  return Boolean(asset.filePath) && !hasBlockingHealthIssue(asset, ['missing_path', 'missing_file', 'broken_symlink']);
}

export function assetCanDelete(asset: Asset | null | undefined) {
  if (!asset) return false;
  if (asset.type === 'mcp') {
    return !hasBlockingHealthIssue(asset, ['missing_config']);
  }
  return Boolean(asset.filePath) && !hasBlockingHealthIssue(asset, ['missing_path', 'missing_file']);
}

export function assetCanInspectMcpTools(asset: Asset | null | undefined) {
  return asset?.type === 'mcp' && !hasBlockingHealthIssue(asset);
}

export interface ProviderStat {
  name: string;
  count: number;
  types: Record<string, number>;
}

export interface Stats {
  total: number;
  skill: number;
  agent: number;
  mcp: number;
  instruction: number;
  rule: number;
  orchestrator: number;
}

export interface ConnectionInfo {
  tool?: string;
  connected: boolean;
  method?: string;
  installed?: boolean;
  supported?: boolean;
  isSource?: boolean;
  isSymlink?: boolean;
  targetPath?: string | null;
}

export interface HistoryEntry {
  id: number;
  action: string;
  asset_name: string;
  details: string;
  created_at: number;
  reverted: number;
  details_json?: Record<string, unknown>;
  snapshot_id?: string | null;
  can_rollback?: boolean;
  rolled_back_at?: number | null;
}

export type Provider = 'claude' | 'codex' | 'gemini' | 'cursor' | 'windsurf' | 'copilot' | 'continue_dev';

export const PROVIDER_LABELS: Record<Provider, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  copilot: 'GitHub Copilot',
  continue_dev: 'Continue',
};

export const TYPE_LABELS: Record<AssetType, string> = {
  skill: 'Skills',
  agent: 'Agents',
  mcp: 'MCP Servers',
  instruction: 'Instructions',
  rule: 'Rules',
};

export interface Project {
  id: string;
  name: string;
  path: string;
  environment_id: string;
  environment_name?: string | null;
  environment_type?: 'local' | 'remote' | null;
  last_scanned_at: number | null;
  created_at: number;
  providers?: string[];
  assetCount?: number;
  assets?: ProjectAsset[];
}

export interface Environment {
  id: string;
  name: string;
  type: 'local' | 'remote';
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_key_path?: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface DiffResult {
  onlyLocal: Asset[];
  onlyRemote: Asset[];
  both: DiffPair[];
  localCount: number;
  remoteCount: number;
  sameCount?: number;
  driftedCount?: number;
  reasonCounts?: Record<string, number>;
}

export interface DiffReason {
  code: string;
  message: string;
}

export interface DiffPair {
  local: Asset;
  remote: Asset;
  status: 'same' | 'drifted';
  reasons: DiffReason[];
  summary: string;
}

export interface McpTool {
  name: string;
  description: string;
  parameters: Record<string, unknown> | null;
}

export interface RunningAgent {
  id: string;
  name: string;
  url: string;
  description: string;
  protocol: string;
  is_active: number;
  created_at: number;
}

export type TopologyNodeKind = 'machine' | 'remote_server' | 'provider' | 'project' | 'running_agent' | 'asset';
export type TopologyEdgeKind = 'contains_project' | 'discovered_on' | 'belongs_to_project' | 'targets_provider' | 'depends_on' | 'runs_on';

export interface TopologyNodeSummary {
  relatedCount?: number;
  assetCount?: number;
  projectCount?: number;
  providerCount?: number;
  environmentCount?: number;
  agentCount?: number;
  activeCount?: number;
  configuredCount?: number;
  missingCount?: number;
  invalidCount?: number;
  warningCount?: number;
  brokenCount?: number;
  dependencyCount?: number;
}

export interface TopologyNode {
  id: string;
  kind: TopologyNodeKind;
  label: string;
  subtitle?: string | null;
  environmentId?: string | null;
  projectId?: string | null;
  assetId?: string | null;
  provider?: string | null;
  assetType?: AssetType | null;
  status?: string | null;
  badges?: string[];
  summary?: TopologyNodeSummary;
}

export interface TopologyEdge {
  id: string;
  kind: TopologyEdgeKind;
  from: string;
  to: string;
  label?: string | null;
  state?: AssetCapabilityState | null;
}

export interface TopologySummary {
  nodeCount: number;
  edgeCount: number;
  machineCount: number;
  remoteServerCount: number;
  providerCount: number;
  projectCount: number;
  runningAgentCount: number;
  assetCount: number;
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  summary: TopologySummary;
}

export interface ProjectAsset {
  id: string;
  name: string;
  desc: string;
  type: AssetType;
  scope: 'global' | 'project';
  projectPath: string;
  projectName: string;
  environment_id?: string;
  environment_type?: 'local' | 'remote';
  filePath?: string;
  providers: string[];
  health?: AssetHealth;
  capabilities?: AssetCapabilities;
}

export const CAPABILITY_STATE_LABELS: Record<AssetCapabilityState, string> = {
  active: 'Active',
  configured: 'Configured',
  available: 'Available',
  missing: 'Missing',
  unsupported: 'Unsupported',
  invalid: 'Invalid',
};

export function capabilitySummaryItems(capabilities?: AssetCapabilities | null) {
  if (!capabilities) return [];
  const { summary } = capabilities;
  return [
    summary.active > 0 ? `${summary.active} active` : null,
    summary.configured > 0 ? `${summary.configured} configured` : null,
    summary.available > 0 ? `${summary.available} available` : null,
    summary.invalid > 0 ? `${summary.invalid} invalid` : null,
    summary.missing > 0 ? `${summary.missing} missing` : null,
    summary.unsupported > 0 ? `${summary.unsupported} unsupported` : null,
  ].filter(Boolean) as string[];
}

export interface SyncIssue {
  level: 'warning' | 'blocking';
  code: string;
  message: string;
}

export interface SyncOperation {
  id: string;
  action: 'create' | 'update' | 'noop';
  mode: string;
  summary: string;
  sourcePath?: string;
  targetPath?: string;
}

export interface SyncPlan {
  source: {
    assetId?: string;
    name: string;
    type: AssetType;
    filePath?: string | null;
  } | null;
  target: {
    kind: 'project' | 'server';
    label: string;
    projectPath?: string;
    serverId?: string;
    method?: 'copy' | 'symlink';
    direction?: 'push' | 'pull';
  } | null;
  operations: SyncOperation[];
  issues: SyncIssue[];
  canApply: boolean;
  hasChanges: boolean;
}

export interface SyncRequest {
  source: {
    assetId?: string;
    name: string;
    type: AssetType;
    filePath?: string;
    providers?: string[];
    projectPath?: string;
  };
  target:
    | {
      kind: 'project';
      projectPath: string;
      method: 'copy' | 'symlink';
    }
    | {
      kind: 'server';
      serverId: string;
      direction: 'push' | 'pull';
    };
}

export interface BatchActionItem {
  assetId?: string;
  name: string;
  type: AssetType;
  filePath?: string;
  providers?: string[];
  projectPath?: string;
  scope?: 'local' | 'project' | 'remote';
}

export interface BatchActionResultItem {
  id: string;
  name: string;
  type: string;
  ok: boolean;
  filePath?: string | null;
  message?: string;
  error?: string;
  health?: AssetHealth;
  status?: AssetHealth['status'];
}

export interface BatchActionResult {
  ok: boolean;
  total: number;
  successCount?: number;
  failureCount?: number;
  okCount?: number;
  warningCount?: number;
  brokenCount?: number;
  results: BatchActionResultItem[];
}

export interface BatchSyncPreviewItem {
  id: string;
  name: string;
  ok: boolean;
  plan?: SyncPlan;
  error?: string;
}

export interface BatchSyncPreview {
  ok: boolean;
  total: number;
  readyCount: number;
  blockedCount: number;
  hasChangesCount: number;
  operationCount: number;
  results: BatchSyncPreviewItem[];
}

export interface BatchSyncApplyItem extends BatchSyncPreviewItem {
  applied?: number;
  skipped?: number;
  message?: string;
}

export interface BatchSyncApplyResult {
  ok: boolean;
  total: number;
  appliedCount: number;
  skippedCount: number;
  successCount: number;
  failureCount: number;
  results: BatchSyncApplyItem[];
}
