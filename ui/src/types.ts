export type AssetType = 'skill' | 'agent' | 'mcp' | 'instruction' | 'rule';
export type AssetHealthStatus = 'warning' | 'broken';
export type AssetCapabilityState = 'active' | 'configured' | 'available' | 'missing' | 'unsupported' | 'invalid';
export type DriftStatus = 'source' | 'synced' | 'drifted' | 'orphaned';
export type DriftSeverity = 'none' | 'low' | 'medium' | 'high';

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

export interface McpRuntimeCheck {
  transport: 'stdio' | 'http' | 'sse' | 'unknown';
  status: 'unknown' | 'ok' | 'warning' | 'broken';
  reachable: boolean;
  phase: string;
  reasonCode: string;
  summary: string;
  details: string[];
  checkedAt: string | null;
  durationMs: number | null;
  toolCount: number | null;
  tools: McpTool[];
  cached: boolean;
  stale: boolean;
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

export interface AssetDependencyRef {
  id: string;
  name: string;
  type?: AssetType | null;
}

export interface AssetDependencyConsumer {
  id: string;
  name: string;
  state: string;
}

export interface AssetDependencyInfo {
  assetId: string;
  name: string;
  type?: AssetType | null;
  dependencyCount: number;
  consumerCount: number;
  assetConsumerCount: number;
  runtimeConsumerCount: number;
  providerConsumerCount: number;
  orphaned: boolean;
  summary: string;
  dependsOn: AssetDependencyRef[];
  dependedOnBy: AssetDependencyRef[];
  runtimeConsumers: AssetDependencyConsumer[];
  providerConsumers: AssetDependencyConsumer[];
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
  drift?: AssetDriftInfo;
  runtime?: McpRuntimeCheck | null;
  dependency?: AssetDependencyInfo;
}

function hasBlockingHealthIssue(
  asset: Pick<Asset, 'health'> | null | undefined,
  codes?: string[],
  excludePrefixes: string[] = []
) {
  if (!asset?.health?.issues?.length) return false;
  return asset.health.issues.some((issue) => issue.level === 'blocking'
    && (!codes || codes.includes(issue.code))
    && !excludePrefixes.some((prefix) => issue.code.startsWith(prefix)));
}

export function assetCanConnect(asset: Asset | null | undefined) {
  if (!asset) return false;
  if (!['skill', 'agent', 'mcp', 'instruction', 'rule'].includes(asset.type)) return false;
  return !hasBlockingHealthIssue(asset, undefined, ['runtime_']);
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
  return asset?.type === 'mcp' && !hasBlockingHealthIssue(asset, ['missing_config', 'missing_transport', 'invalid_command', 'invalid_url', 'invalid_args', 'missing_path', 'missing_file', 'broken_symlink']);
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
  details_json?: HistoryDetails | null;
  snapshot_id?: string | null;
  can_rollback?: boolean;
  rolled_back_at?: number | null;
}

export interface HistoryActor {
  kind: string;
  user?: string | null;
  host?: string | null;
  client?: string | null;
}

export interface HistoryApproval {
  required: boolean;
  confirmed: boolean;
  note?: string | null;
  reason?: string | null;
  source?: string | null;
}

export interface HistoryTarget {
  kind: string;
  id?: string | null;
  label?: string | null;
}

export interface HistoryEffect {
  applied?: number;
  skipped?: number;
  total?: number;
  restored?: number;
  operationCount?: number;
  resultCount?: number;
}

export interface HistoryDetails {
  assetId?: string | null;
  assetType?: AssetType | null;
  snapshotId?: string | null;
  summary?: string | null;
  actor?: HistoryActor | null;
  approval?: HistoryApproval | null;
  target?: HistoryTarget | null;
  effect?: HistoryEffect | null;
  metadata?: Record<string, unknown> | null;
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
  project_type?: string | null;
  last_scanned_at: number | null;
  created_at: number;
  providers?: string[];
  assetCount?: number;
  assets?: ProjectAsset[];
  git?: GitContext | null;
  policy?: PolicySubjectStatus | null;
}

export interface Environment {
  id: string;
  name: string;
  type: 'local' | 'remote';
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_key_path?: string;
  read_only?: number;
  is_active: number;
  created_at: number;
  updated_at: number;
  policy?: PolicySubjectStatus | null;
}

export interface AuditEnvironmentPolicy {
  environment_id: string;
  name: string;
  type: 'local' | 'remote';
  read_only: boolean;
  ssh_host?: string | null;
}

export interface AuditMode {
  global_read_only: boolean;
  environments: AuditEnvironmentPolicy[];
}

export interface AuditReportEnvironment {
  id: string;
  name: string;
  type: 'local' | 'remote';
  read_only: boolean;
  ssh_host?: string | null;
  ssh_user?: string | null;
  project_count: number;
  asset_count: number;
}

export interface AuditReportSummary {
  asset_count: number;
  project_count: number;
  local_project_count: number;
  remote_project_count: number;
  environment_count: number;
  remote_server_count: number;
  running_agent_count: number;
  broken_asset_count: number;
  warning_asset_count: number;
  drift_group_count: number;
  drifted_group_count: number;
  orphaned_group_count: number;
}

export interface AuditReportIssue {
  id: string;
  name: string;
  type: AssetType;
  status: 'warning' | 'broken';
  summary: string;
}

export interface AuditReport {
  generated_at: string;
  audit_mode: AuditMode;
  summary: AuditReportSummary;
  blocked_actions: string[];
  providers: ProviderStat[];
  environments: AuditReportEnvironment[];
  top_issues: AuditReportIssue[];
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
  introspection?: RunningAgentIntrospection | null;
}

export interface RunningAgentAssetState {
  assetId: string;
  name: string;
  type: AssetType;
  state: 'configured' | 'loaded' | 'active';
  matchedTools: string[];
  environmentId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  projectPath?: string | null;
  filePath?: string | null;
  detail: string;
}

export interface RunningAgentActiveTool {
  name: string;
  description: string;
  matchedAssetIds: string[];
  state: 'matched' | 'unmatched';
}

export interface RunningAgentIntrospection {
  agentId: string;
  status: 'unknown' | 'ok' | 'warning' | 'broken';
  reachable: boolean;
  summary: string;
  details: string[];
  checkedAt: string | null;
  durationMs: number | null;
  toolCount: number | null;
  configuredCount: number;
  loadedCount: number;
  activeCount: number;
  activeToolCount: number;
  unmatchedToolCount: number;
  cached: boolean;
  stale: boolean;
  assets: RunningAgentAssetState[];
  activeTools: RunningAgentActiveTool[];
}

export type TopologyNodeKind = 'machine' | 'remote_server' | 'provider' | 'project' | 'running_agent' | 'asset';
export type TopologyEdgeKind = 'contains_project' | 'discovered_on' | 'belongs_to_project' | 'targets_provider' | 'depends_on' | 'runs_on' | 'loaded_by';

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
  assetConsumerCount?: number;
  runtimeConsumerCount?: number;
  providerConsumerCount?: number;
  consumerCount?: number;
  orphaned?: boolean;
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

export interface DependencyGraphSummary {
  assetCount: number;
  orphanedCount: number;
  usedCount: number;
  dependencyEdgeCount: number;
  assetConsumerCount: number;
  runtimeConsumerCount: number;
  providerConsumerCount: number;
}

export interface DependencyGraph {
  byAssetId: Record<string, AssetDependencyInfo>;
  orphanedAssetIds: string[];
  summary: DependencyGraphSummary;
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
  drift?: AssetDriftInfo;
  git?: GitContext | null;
}

export type GitFileStatus = 'clean' | 'modified' | 'staged' | 'untracked' | 'conflicted';

export interface GitContext {
  repoRoot: string;
  branch: string;
  dirty: boolean;
  conflictedCount: number;
  modifiedCount: number;
  stagedCount: number;
  untrackedCount: number;
  relevantStatus?: GitFileStatus | null;
  summary: string;
}

export interface AssetDriftInfo {
  groupKey: string;
  status: DriftStatus;
  severity: DriftSeverity;
  sourceAssetId?: string | null;
  sourceMode?: 'explicit' | 'inferred' | 'missing';
  isSourceOfTruth: boolean;
  summary: string;
  copyCount: number;
}

export interface DriftReason {
  code: string;
  message: string;
}

export interface DriftMember {
  assetId: string;
  name: string;
  type: AssetType;
  filePath?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  projectPath?: string | null;
  environmentId?: string | null;
  environmentName?: string | null;
  environmentType?: 'local' | 'remote' | null;
  providers: string[];
  health?: AssetHealth | null;
  capabilities?: AssetCapabilities | null;
  scope: 'local' | 'project' | 'remote' | 'remote_project';
  locationLabel: string;
  sourceOfTruth: boolean;
  status: DriftStatus;
  differsFromSource: boolean;
  reasons: DriftReason[];
  summary: string;
}

export interface DriftGroup {
  key: string;
  name: string;
  type: AssetType;
  status: DriftStatus;
  severity: DriftSeverity;
  summary: string;
  copyCount: number;
  sourceAssetId?: string | null;
  sourceMode?: 'explicit' | 'inferred' | 'missing';
  members: DriftMember[];
}

export interface DriftSummary {
  totalGroups: number;
  totalCopies: number;
  driftedGroups: number;
  orphanedGroups: number;
  syncedGroups: number;
  sourceGroups: number;
}

export interface DriftGraph {
  groups: DriftGroup[];
  byAssetId: Record<string, AssetDriftInfo>;
  summary: DriftSummary;
}

export const DRIFT_STATUS_LABELS: Record<DriftStatus, string> = {
  source: 'Source',
  synced: 'Synced',
  drifted: 'Drifted',
  orphaned: 'Orphaned',
};

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

export interface BundleItem {
  assetId?: string | null;
  name: string;
  type: AssetType;
  filePath?: string | null;
  providers?: string[];
  projectPath?: string | null;
  scope?: string | null;
}

export interface BundleVersion {
  id: string;
  version: number;
  label: string;
  description: string;
  items: BundleItem[];
  itemCount: number;
  created_at: number;
}

export interface BundleApplication {
  id: string;
  target_kind: 'provider' | 'project' | 'server' | 'running_agent';
  target_ref: string;
  target_label: string;
  target_meta: Record<string, unknown>;
  bundle_version: number;
  applied_at: number;
  last_status: string;
  last_summary: string;
  outdated: boolean;
}

export interface Bundle {
  id: string;
  name: string;
  description: string;
  current_version: number;
  items: BundleItem[];
  itemCount: number;
  versions: BundleVersion[];
  applications: BundleApplication[];
  applicationCount: number;
  outdatedApplicationCount: number;
  lastAppliedAt: number | null;
  created_at: number;
  updated_at: number;
}

export type BundleTarget =
  | {
    kind: 'provider';
    provider: Provider;
    projectPath?: string | null;
  }
  | {
    kind: 'project';
    projectPath: string;
    method: 'copy' | 'symlink';
  }
  | {
    kind: 'server';
    serverId: string;
  }
  | {
    kind: 'running_agent';
    agentId: string;
    method?: 'copy' | 'symlink';
  };

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
    kind: 'project' | 'server' | 'provider';
    label: string;
    projectPath?: string;
    serverId?: string;
    method?: 'copy' | 'symlink';
    direction?: 'push' | 'pull';
    provider?: Provider;
    git?: GitContext | null;
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
      kind: 'provider';
      provider: Provider;
      projectPath?: string | null;
    }
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
  approval?: {
    confirmed: boolean;
    note?: string | null;
    source?: string | null;
  };
}

export interface BundlePreviewData {
  bundleId: string;
  bundleVersion: number;
  target: (BundleTarget & {
    label?: string;
    ref?: string;
    meta?: Record<string, unknown>;
  }) | null;
  resolvedTarget: SyncRequest['target'] | null;
  preview: BatchSyncPreview;
}

export interface BundleApplyData extends BundlePreviewData {
  ok: boolean;
  result: BatchSyncApplyResult | null;
  error?: string | null;
}

export interface WorkspaceManifestSummary {
  assetCount: number;
  bundleCount: number;
  policyCount: number;
  projectCount: number;
}

export interface WorkspaceManifestTopologyProject {
  id: string;
  name: string;
  path: string;
  projectType?: string | null;
}

export interface WorkspaceManifestTopologyProvider {
  provider: string;
  count: number;
}

export interface WorkspaceManifestAssetRecord {
  key: string;
  name: string;
  type: AssetType;
  scope: 'local' | 'project';
  provider?: string | null;
  fileName?: string | null;
  filePath?: string | null;
  projectPath?: string | null;
  projectName?: string | null;
  projectType?: string | null;
  description?: string;
  category?: string;
  providers?: string[];
  tags?: string[];
  keywords?: string;
  deps?: string[];
  content?: string | null;
  rawConfig?: Record<string, unknown> | null;
}

export interface WorkspaceManifestBundleRecord {
  id?: string;
  name: string;
  description?: string;
  currentVersion?: number;
  items: BundleItem[];
  versions?: BundleVersion[];
  applications?: BundleApplication[];
}

export interface WorkspaceManifestPolicyRecord {
  id?: string;
  name: string;
  description?: string;
  enabled: boolean;
  severity: PolicySeverity;
  selectors: PolicySelectors;
  rules: PolicyRule[];
}

export interface WorkspaceManifest {
  kind: string;
  schemaVersion: number;
  exportedAt: number;
  source?: {
    app?: string;
    version?: number;
  } | null;
  summary?: WorkspaceManifestSummary | null;
  topology?: {
    projects?: WorkspaceManifestTopologyProject[];
    providers?: WorkspaceManifestTopologyProvider[];
  } | null;
  assets: WorkspaceManifestAssetRecord[];
  bundles: WorkspaceManifestBundleRecord[];
  policies: WorkspaceManifestPolicyRecord[];
}

export interface WorkspaceManifestExportOptions {
  includeAssets: boolean;
  includeBundles: boolean;
  includePolicies: boolean;
  assetIds?: string[];
  bundleIds?: string[];
  policyIds?: string[];
}

export interface WorkspaceManifestPreviewEntryIssue {
  level: 'warning' | 'blocking';
  code: string;
  message: string;
}

export interface WorkspaceManifestAssetPreviewEntry {
  key: string;
  name: string;
  type: AssetType;
  scope: 'local' | 'project';
  provider?: string | null;
  action: 'create' | 'update' | 'noop' | 'blocked';
  targetPath?: string | null;
  projectPath?: string | null;
  summary: string;
  issues: WorkspaceManifestPreviewEntryIssue[];
  canApply: boolean;
}

export interface WorkspaceManifestNamedPreviewEntry {
  name: string;
  action: 'create' | 'update' | 'noop';
  existingId?: string | null;
  summary: string;
  canApply: boolean;
}

export interface WorkspaceManifestImportCounts {
  assets: {
    create: number;
    update: number;
    noop: number;
    blocked: number;
  };
  bundles: {
    create: number;
    update: number;
    noop: number;
  };
  policies: {
    create: number;
    update: number;
    noop: number;
  };
}

export interface WorkspaceManifestPreviewHeader {
  kind: string;
  schemaVersion: number;
  exportedAt: number;
  summary?: WorkspaceManifestSummary | null;
}

export interface WorkspaceManifestImportPreviewData {
  manifest: WorkspaceManifestPreviewHeader;
  assets: WorkspaceManifestAssetPreviewEntry[];
  bundles: WorkspaceManifestNamedPreviewEntry[];
  policies: WorkspaceManifestNamedPreviewEntry[];
  issues: WorkspaceManifestPreviewEntryIssue[];
  counts: WorkspaceManifestImportCounts;
  writeCount: number;
  canApply: boolean;
}

export interface WorkspaceManifestImportResult {
  assetWrites: number;
  bundleWrites: number;
  policyWrites: number;
  writeCount: number;
}

export interface WorkspaceManifestImportApplyData {
  preview: WorkspaceManifestImportPreviewData;
  result: WorkspaceManifestImportResult;
}

export type PolicySeverity = 'warning' | 'blocking';
export type PolicyMode = 'required' | 'forbidden' | 'recommended';
export type PolicyScope = 'project' | 'environment' | 'any';
export type PolicySubjectKind = 'project' | 'environment';
export type PolicySubjectStatusState = 'ok' | 'warning' | 'broken';

export interface PolicySelectors {
  environmentIds?: string[];
  environmentTypes?: Array<'local' | 'remote'>;
  projectIds?: string[];
  projectTypes?: string[];
  projectPathPatterns?: string[];
  providers?: Provider[];
}

export interface PolicyRule {
  mode: PolicyMode;
  assetType: AssetType;
  scope: PolicyScope;
  name?: string | null;
  namePattern?: string | null;
  provider?: Provider | null;
  note?: string | null;
}

export interface Policy {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: PolicySeverity;
  selectors: PolicySelectors;
  rules: PolicyRule[];
  created_at: number;
  updated_at: number;
}

export interface PolicyViolation {
  id: string;
  policyId: string;
  policyName: string;
  severity: PolicySeverity;
  mode: PolicyMode;
  assetType: AssetType;
  scope: PolicyScope;
  name?: string | null;
  namePattern?: string | null;
  provider?: Provider | null;
  message: string;
  note?: string | null;
  matchedAssets?: Array<{
    id: string;
    name: string;
    type: AssetType;
    filePath?: string | null;
  }>;
}

export interface PolicySubjectStatus {
  kind: PolicySubjectKind;
  subjectId: string;
  projectId?: string | null;
  environmentId?: string | null;
  name: string;
  path?: string | null;
  projectType?: string | null;
  environmentName?: string | null;
  environmentType?: 'local' | 'remote' | null;
  providers: string[];
  status: PolicySubjectStatusState;
  violationCount: number;
  blockingCount: number;
  warningCount: number;
  summary: string;
  matchedPolicyIds: string[];
  violations: PolicyViolation[];
}

export interface PolicyEvaluation {
  projects: PolicySubjectStatus[];
  environments: PolicySubjectStatus[];
  byProjectId: Record<string, PolicySubjectStatus>;
  byEnvironmentId: Record<string, PolicySubjectStatus>;
  summary: {
    policyCount: number;
    projectCount: number;
    environmentCount: number;
    violatingProjectCount: number;
    violatingEnvironmentCount: number;
    blockingCount: number;
    warningCount: number;
    violationCount: number;
  };
}

export interface RemediationSuggestion {
  id: string;
  category: 'health' | 'runtime' | 'drift' | 'policy' | string;
  action: 'runtime_check' | 'repair_from_source' | 'promote_source_of_truth' | 'sync_missing_asset' | 'guided_mcp_fix' | 'guided_fix' | string;
  title: string;
  summary: string;
  details: string[];
  applyLabel?: string | null;
  canApply: boolean;
  risky: boolean;
  issueCodes: string[];
  syncRequest?: SyncRequest | null;
  sourceAssetId?: string | null;
}

export function policySummaryItems(status?: PolicySubjectStatus | null) {
  if (!status || status.violationCount === 0) return [];
  return [
    status.blockingCount > 0 ? `${status.blockingCount} blocking` : null,
    status.warningCount > 0 ? `${status.warningCount} warning` : null,
  ].filter(Boolean) as string[];
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
