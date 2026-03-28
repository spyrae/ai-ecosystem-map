export type AssetType = 'skill' | 'agent' | 'mcp' | 'instruction' | 'rule';

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  desc: string;
  cat: string;
  filePath: string;
  tags: string[];
  providers: string[];
  keywords: string;
  deps: string[];
  isOrchestrator: boolean;
  hash: string;
  environment_id: string;
  discovered_at: number;
  updated_at: number;
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
  tool: string;
  connected: boolean;
  method?: string;
}

export interface HistoryEntry {
  id: number;
  action: string;
  asset_name: string;
  details: string;
  created_at: number;
  reverted: number;
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
  both: { local: Asset; remote: Asset }[];
  localCount: number;
  remoteCount: number;
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

export interface ProjectAsset {
  name: string;
  desc: string;
  type: AssetType;
  scope: 'global' | 'project';
  projectPath: string;
  projectName: string;
  filePath?: string;
  providers: string[];
}
