import { useEffect, useRef, useState } from 'react';
import type { AssetType } from '../types';
import { createAsset, generateAsset } from '../lib/api';

interface CreateAssetModalProps {
  onClose: () => void;
  onCreated: () => void;
  readOnly?: boolean;
}

type Mode = 'manual' | 'ai' | 'import';

const TEMPLATES: Record<string, string> = {
  skill: `---
name: my-skill
description: "What this skill does. Use when [triggers]. Do NOT use for [negative triggers]."
---

# My Skill

## Steps

1. First step
2. Second step

## Output Format

\`\`\`
Expected output here
\`\`\`
`,
  agent: `---
name: my-agent
description: "Agent for handling specific tasks"
model: sonnet
---

# My Agent

You are a specialized agent for...

## Tools Available

- Read, Write, Edit, Bash, Grep, Glob

## Workflow

1. Analyze the task
2. Execute the work
3. Return results
`,
  rule: `# My Rule

## Guidelines

- Rule 1
- Rule 2

## Patterns

Follow these patterns when...
`,
  mcp: `{
  "command": "npx",
  "args": ["-y", "your-mcp-server"],
  "env": {}
}
`,
};

// Unified rule provider entry — each maps to a specific backend type + file location
interface RuleProviderEntry {
  key: string;
  provider: string;
  backendType: AssetType;
  label: string;
  desc: string;
}

// Provider options per asset type
const TYPE_PROVIDERS: Record<string, { value: string; label: string; desc: string }[]> = {
  skill: [
    { value: 'claude', label: 'Claude Code', desc: '~/.claude/commands/' },
    { value: 'codex', label: 'Codex CLI', desc: '~/.codex/skills/public/' },
    { value: 'gemini', label: 'Gemini CLI', desc: '~/.gemini/skills/' },
  ],
  agent: [
    { value: 'claude', label: 'Claude Code', desc: '~/.claude/agents/' },
    { value: 'codex', label: 'Codex CLI', desc: '~/.codex/agents/' },
  ],
  mcp: [
    { value: 'claude', label: 'Claude Code', desc: '~/.claude/.mcp.json or project .mcp.json' },
    { value: 'codex', label: 'Codex CLI', desc: '~/.codex/mcp.json' },
    { value: 'gemini', label: 'Gemini CLI', desc: '~/.gemini/mcp.json' },
    { value: 'windsurf', label: 'Windsurf', desc: '~/.windsurf/mcp.json' },
    { value: 'continue_dev', label: 'Continue', desc: '~/.continue/config.json' },
  ],
};

// Merged rule providers: each entry = one specific file destination
const RULE_PROVIDERS: RuleProviderEntry[] = [
  { key: 'claude:rule', provider: 'claude', backendType: 'rule', label: 'Claude Code', desc: '.claude/rules/' },
  { key: 'claude:instruction', provider: 'claude', backendType: 'instruction', label: 'Claude Code', desc: 'CLAUDE.md' },
  { key: 'cursor:rule', provider: 'cursor', backendType: 'rule', label: 'Cursor', desc: '.cursor/rules/' },
  { key: 'cursor:instruction', provider: 'cursor', backendType: 'instruction', label: 'Cursor', desc: '.cursorrules' },
  { key: 'windsurf:rule', provider: 'windsurf', backendType: 'rule', label: 'Windsurf', desc: '.windsurf/rules/' },
  { key: 'windsurf:instruction', provider: 'windsurf', backendType: 'instruction', label: 'Windsurf', desc: '.windsurfrules' },
  { key: 'codex:instruction', provider: 'codex', backendType: 'instruction', label: 'Codex CLI', desc: 'AGENTS.md' },
  { key: 'gemini:instruction', provider: 'gemini', backendType: 'instruction', label: 'Gemini CLI', desc: 'GEMINI.md' },
  { key: 'copilot:instruction', provider: 'copilot', backendType: 'instruction', label: 'GitHub Copilot', desc: '.github/copilot-instructions.md' },
];

function instructionNameForProvider(provider: string) {
  switch (provider) {
    case 'claude': return 'claude';
    case 'codex': return 'agents';
    case 'gemini': return 'gemini';
    case 'copilot': return 'copilot-instructions';
    case 'cursor': return 'cursorrules';
    case 'windsurf': return 'windsurfrules';
    default: return 'instructions';
  }
}

function supportsProjectScope(type: AssetType, provider: string) {
  if (type === 'rule') return true;
  if (type === 'skill') return provider !== 'continue_dev';
  if (type === 'agent') return provider === 'claude';
  if (type === 'mcp') return provider === 'claude';
  if (type === 'instruction') return ['claude', 'codex', 'gemini', 'copilot', 'cursor', 'windsurf'].includes(provider);
  return false;
}

function supportsGlobalScope(type: AssetType, provider: string) {
  if (type === 'rule') return false;
  if (type === 'instruction') return ['claude', 'codex', 'gemini'].includes(provider);
  return true;
}

// Infer name/type from imported file content
function inferAssetFromContent(fileName: string, content: string): { type: AssetType | null; name: string } {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const baseName = fileName.replace(/\.[^.]+$/, '').toLowerCase().replace(/\s+/g, '-');

  // Check for frontmatter with type hints
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const nameMatch = fm.match(/^name:\s*(.+)/m);
    const descMatch = fm.match(/^description:\s*(.+)/m);
    const modelMatch = fm.match(/^model:\s*/m);
    const inferredName = nameMatch ? nameMatch[1].trim().replace(/['"]/g, '') : baseName;

    if (modelMatch || (descMatch && /agent/i.test(descMatch[1]))) {
      return { type: 'agent', name: inferredName };
    }
    if (descMatch && /use when/i.test(descMatch[1])) {
      return { type: 'skill', name: inferredName };
    }
    // Has frontmatter — likely skill or agent
    return { type: 'skill', name: inferredName };
  }

  // JSON = MCP config
  if (ext === 'json') {
    try {
      const parsed = JSON.parse(content);
      if (parsed.command || parsed.url || parsed.args) return { type: 'mcp', name: baseName };
    } catch { /* not json */ }
  }

  // Markdown without frontmatter = rule
  if (ext === 'md') return { type: 'rule', name: baseName };

  return { type: null, name: baseName };
}

export function CreateAssetModal({ onClose, onCreated, readOnly = false }: CreateAssetModalProps) {
  const [mode, setMode] = useState<Mode>('manual');
  const [type, setType] = useState<AssetType>('skill');
  const [name, setName] = useState('');
  const [content, setContent] = useState(TEMPLATES.skill);
  const [provider, setProvider] = useState('claude');
  const [scope, setScope] = useState<'global' | 'project'>('global');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // For "rule" type, track which specific rule provider entry is selected
  const [ruleProviderKey, setRuleProviderKey] = useState(RULE_PROVIDERS[0].key);

  // AI mode
  const [aiPrompt, setAiPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);

  // Import mode
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Resolve the actual backend type for rules
  const selectedRuleProvider = RULE_PROVIDERS.find((rp) => rp.key === ruleProviderKey) || RULE_PROVIDERS[0];
  const effectiveType: AssetType = type === 'rule' ? selectedRuleProvider.backendType : type;
  const effectiveProvider = type === 'rule' ? selectedRuleProvider.provider : provider;

  useEffect(() => {
    if (effectiveType === 'instruction') {
      setName(instructionNameForProvider(effectiveProvider));
    }
    if (type === 'rule' && selectedRuleProvider.backendType === 'rule') {
      setScope('project');
    } else if (!supportsProjectScope(effectiveType, effectiveProvider)) {
      setScope('global');
    } else if (!supportsGlobalScope(effectiveType, effectiveProvider) && scope === 'global') {
      setScope('project');
    }
  }, [type, effectiveType, effectiveProvider, selectedRuleProvider, scope]);

  const handleTypeChange = (newType: AssetType) => {
    setType(newType);
    setContent(TEMPLATES[newType] || TEMPLATES.rule);
    if (newType === 'rule') {
      setRuleProviderKey(RULE_PROVIDERS[0].key);
    } else {
      const providers = TYPE_PROVIDERS[newType];
      if (providers?.length) setProvider(providers[0].value);
    }
    setGenerated(false);
    setImportedFileName(null);
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) { setError('Could not read file'); return; }

      const inferred = inferAssetFromContent(file.name, text);

      // Auto-detect type if possible
      if (inferred.type && inferred.type !== type) {
        setType(inferred.type);
        if (inferred.type === 'rule') {
          setRuleProviderKey(RULE_PROVIDERS[0].key);
        } else {
          const providers = TYPE_PROVIDERS[inferred.type];
          if (providers?.length) setProvider(providers[0].value);
        }
      }

      setContent(text);
      setName(inferred.name);
      setImportedFileName(file.name);
      setMode('manual'); // Switch to manual for review
    };
    reader.readAsText(file);

    // Reset input so same file can be re-imported
    e.target.value = '';
  };

  const handleGenerate = async () => {
    if (!aiPrompt.trim()) { setError('Describe what you need'); return; }
    setGenerating(true);
    setError(null);
    try {
      const res = await generateAsset(effectiveType, name || 'untitled', aiPrompt);
      if (res.ok && res.content) {
        setContent(res.content);
        setGenerated(true);
        setMode('manual'); // Switch to manual to show/edit the result
      } else {
        setError(res.error || 'Generation failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = async () => {
    if (readOnly) {
      setError('Global read-only audit mode is enabled');
      return;
    }
    const isInstruction = effectiveType === 'instruction';
    const finalName = isInstruction ? instructionNameForProvider(effectiveProvider) : name.trim();
    if (!finalName) { setError('Name is required'); return; }
    if ((effectiveType === 'skill' || effectiveType === 'agent' || effectiveType === 'rule') && !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$|^[a-z0-9]$/.test(finalName)) {
      setError('Name must be kebab-case (lowercase, hyphens, no spaces)');
      return;
    }
    if (effectiveType === 'mcp' && !/^[A-Za-z0-9._:-]+$/.test(finalName)) {
      setError('MCP name may contain letters, numbers, dot, underscore, colon and hyphen');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      let config: Record<string, unknown> | undefined;
      if (effectiveType === 'mcp') {
        try {
          config = JSON.parse(content);
        } catch {
          setError('MCP config must be valid JSON');
          setCreating(false);
          return;
        }
      }
      const res = await createAsset({ name: finalName, type: effectiveType, content, provider: effectiveProvider, scope, config });
      if (res.ok) {
        onCreated();
        onClose();
      } else {
        setError(res.error || 'Create failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setCreating(false);
    }
  };

  const providers = TYPE_PROVIDERS[type] || [];
  const isRuleType = type === 'rule';
  const isInstructionTarget = effectiveType === 'instruction';

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-[0_16px_48px_rgba(0,0,0,.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border shrink-0">
          <h3 className="text-base font-semibold text-text">Create New Asset</h3>
        </div>

        {/* Type + Name + Provider */}
        <div className="px-6 py-4 border-b border-border space-y-3 shrink-0">
          {/* Type selector */}
          <div className="flex gap-2">
            {(['skill', 'agent', 'mcp', 'rule'] as AssetType[]).map((t) => (
              <button
                key={t}
                onClick={() => handleTypeChange(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  type === t ? 'bg-accent/15 text-accent border border-accent/30' : 'bg-surface2 text-muted border border-border hover:text-text'
                }`}
              >
                {t === 'skill' ? '⚡ Skill' : t === 'agent' ? '🤖 Agent' : t === 'mcp' ? '🔌 MCP' : '📏 Rule'}
              </button>
            ))}
          </div>

          {/* Name */}
          <input
            type="text"
            value={name}
            onChange={(e) => setName(type === 'mcp' ? e.target.value : e.target.value.toLowerCase().replace(/\s+/g, '-'))}
            placeholder={
              isInstructionTarget
                ? `derived from provider (${effectiveProvider})`
                : type === 'mcp'
                  ? 'server-name'
                  : 'asset-name (kebab-case)'
            }
            readOnly={isInstructionTarget}
            className="w-full bg-bg border border-border rounded-lg px-4 py-2 text-sm text-text font-mono placeholder:text-muted focus:outline-none focus:border-accent"
          />

          {/* Provider selection — rules use merged RULE_PROVIDERS */}
          {isRuleType ? (
            <div>
              <div className="text-[11px] text-muted uppercase tracking-wider mb-1.5">Destination</div>
              <div className="flex flex-wrap gap-2">
                {RULE_PROVIDERS.map((rp) => (
                  <button
                    key={rp.key}
                    onClick={() => setRuleProviderKey(rp.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                      ruleProviderKey === rp.key
                        ? 'bg-accent/15 text-accent border border-accent/30'
                        : 'bg-bg text-muted border border-border hover:text-text hover:border-accent/30'
                    }`}
                  >
                    <span className="font-medium">{rp.label}</span>
                    <span className="ml-1.5 text-[10px] opacity-60">{rp.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : providers.length > 1 ? (
            <div>
              <div className="text-[11px] text-muted uppercase tracking-wider mb-1.5">Provider</div>
              <div className="flex flex-wrap gap-2">
                {providers.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setProvider(p.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                      provider === p.value
                        ? 'bg-accent/15 text-accent border border-accent/30'
                        : 'bg-bg text-muted border border-border hover:text-text hover:border-accent/30'
                    }`}
                  >
                    <span className="font-medium">{p.label}</span>
                    <span className="ml-1.5 text-[10px] opacity-60">{p.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Scope: global vs project */}
          {supportsProjectScope(effectiveType, effectiveProvider) && (
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-muted uppercase tracking-wider">Scope:</span>
              {supportsGlobalScope(effectiveType, effectiveProvider) && (
                <button
                  onClick={() => setScope('global')}
                  className={`px-2 py-1 rounded text-xs ${scope === 'global' ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text'}`}
                >
                  Global
                </button>
              )}
              <button
                onClick={() => setScope('project')}
                className={`px-2 py-1 rounded text-xs ${scope === 'project' ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text'}`}
              >
                Project-local
              </button>
            </div>
          )}

          {error && <div className="text-xs text-red">{error}</div>}
          {readOnly && <div className="text-xs text-amber-300">Global read-only audit mode is enabled. Asset creation is disabled.</div>}
        </div>

        {/* Mode tabs: Manual / AI / Import */}
        <div className="flex gap-1 px-6 pt-3 shrink-0">
          <button
            onClick={() => setMode('manual')}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-medium border-b-2 transition-colors ${
              mode === 'manual'
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            ✏️ Write manually
          </button>
          {/* Hidden until LLM is configured
          <button
            onClick={() => setMode('ai')}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-medium border-b-2 transition-colors ${
              mode === 'ai'
                ? 'border-purple text-purple'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            🤖 Generate with AI
          </button>
          */}
          <button
            onClick={() => setMode('import')}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-medium border-b-2 transition-colors ${
              mode === 'import'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            📁 Import from file
          </button>
          {generated && (
            <span className="px-2 py-1.5 text-[10px] text-green self-center">✓ AI generated — review & edit below</span>
          )}
          {importedFileName && mode === 'manual' && (
            <span className="px-2 py-1.5 text-[10px] text-cyan-400 self-center">✓ Imported from {importedFileName}</span>
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-6 pt-3">
          {mode === 'manual' ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-full min-h-[300px] bg-bg border border-border rounded-lg p-4 font-mono text-sm text-text resize-none focus:outline-none focus:border-accent"
              spellCheck={false}
              placeholder={effectiveType === 'mcp' ? 'MCP server JSON config...' : 'File content...'}
            />
          ) : mode === 'ai' ? (
            <div className="space-y-3">
              <div className="text-xs text-muted">
                Describe what you need and AI will generate the {type === 'rule' ? 'rule' : type} for you.
                {type === 'skill' && ' It follows the Skill Factory methodology — proper frontmatter, triggers, steps, output format.'}
                {type === 'agent' && ' It will define role, tools, workflow, and output expectations.'}
              </div>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                className="w-full min-h-[200px] bg-bg border border-border rounded-lg p-4 text-sm text-text resize-none focus:outline-none focus:border-accent"
                spellCheck={false}
                placeholder={
                  type === 'skill'
                    ? 'e.g. "A skill for deploying Docker containers to VPS. Should check Dockerfile, build image, push to registry, and deploy via SSH. Include rollback steps."'
                    : type === 'agent'
                    ? 'e.g. "An agent specialized in database migrations. Can read schema, generate SQL, validate changes, and apply migrations safely."'
                    : type === 'rule'
                    ? 'e.g. "Rules for a React project with TypeScript. Use functional components, Zustand for state, TanStack Query for data fetching."'
                    : 'e.g. "MCP server config for connecting to a custom API."'
                }
              />
              <button
                onClick={handleGenerate}
                disabled={generating || !aiPrompt.trim()}
                className="px-4 py-2 text-sm font-medium bg-purple/20 text-purple border border-purple/30 rounded-lg hover:bg-purple/30 transition-colors disabled:opacity-40"
              >
                {generating ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Generating...
                  </span>
                ) : '🤖 Generate'}
              </button>
            </div>
          ) : (
            /* Import mode */
            <div className="space-y-4">
              <div className="text-xs text-muted">
                Import an existing file — skill, agent, rule, or MCP config. The type and name will be auto-detected from the file content.
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt,.json,.yaml,.yml"
                onChange={handleFileImport}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-3 w-full p-6 rounded-xl border-2 border-dashed border-border hover:border-accent/40 transition-colors group cursor-pointer"
              >
                <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-surface2 group-hover:bg-accent/10 transition-colors">
                  <svg className="w-6 h-6 text-muted group-hover:text-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-text group-hover:text-accent transition-colors">
                    Choose a file
                  </div>
                  <div className="text-[11px] text-muted">
                    .md, .txt, .json, .yaml — type auto-detected from content
                  </div>
                </div>
              </button>
              {importedFileName && (
                <div className="flex items-center gap-2 px-3 py-2 bg-cyan-400/10 border border-cyan-400/20 rounded-lg">
                  <span className="text-cyan-400 text-xs font-medium">✓ {importedFileName}</span>
                  <span className="text-[10px] text-muted">— switch to "Write manually" tab to review and edit</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-border shrink-0">
          <button onClick={onClose} className="text-sm text-muted hover:text-text">Cancel</button>
          <button
            onClick={handleCreate}
            disabled={readOnly || creating || (!isInstructionTarget && !name.trim()) || (mode === 'ai' && !generated)}
            className="px-4 py-2 text-sm font-medium bg-accent text-bg rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-40"
          >
            {creating ? 'Creating...' : `Create ${type === 'rule' ? 'rule' : type}`}
          </button>
        </div>
      </div>
    </div>
  );
}
