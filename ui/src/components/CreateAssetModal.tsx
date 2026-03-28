import { useState } from 'react';
import type { AssetType } from '../types';
import { createAsset, generateAsset } from '../lib/api';

interface CreateAssetModalProps {
  onClose: () => void;
  onCreated: () => void;
}

type Mode = 'manual' | 'ai';

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
  instruction: `# Instructions

## Context

This project uses...

## Rules

- Always do X
- Never do Y
`,
};

// Provider options per asset type
const TYPE_PROVIDERS: Record<string, { value: string; label: string; desc: string }[]> = {
  skill: [
    { value: 'claude', label: 'Claude Code', desc: '~/.claude/commands/ — also works with Codex & Gemini' },
  ],
  agent: [
    { value: 'claude', label: 'Claude Code', desc: '~/.claude/agents/' },
  ],
  rule: [
    { value: 'cursor', label: 'Cursor', desc: '.cursor/rules/' },
    { value: 'windsurf', label: 'Windsurf', desc: '.windsurf/rules/' },
    { value: 'claude', label: 'Claude Code', desc: '.claude/rules/' },
  ],
  instruction: [
    { value: 'claude', label: 'Claude Code', desc: 'CLAUDE.md' },
    { value: 'codex', label: 'Codex CLI', desc: 'AGENTS.md' },
    { value: 'gemini', label: 'Gemini CLI', desc: 'GEMINI.md' },
    { value: 'copilot', label: 'GitHub Copilot', desc: '.github/copilot-instructions.md' },
    { value: 'cursor', label: 'Cursor', desc: '.cursorrules' },
    { value: 'windsurf', label: 'Windsurf', desc: '.windsurfrules' },
  ],
};

export function CreateAssetModal({ onClose, onCreated }: CreateAssetModalProps) {
  const [mode, setMode] = useState<Mode>('manual');
  const [type, setType] = useState<AssetType>('skill');
  const [name, setName] = useState('');
  const [content, setContent] = useState(TEMPLATES.skill);
  const [provider, setProvider] = useState('claude');
  const [scope, setScope] = useState<'global' | 'project'>('global');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI mode
  const [aiPrompt, setAiPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);

  const handleTypeChange = (newType: AssetType) => {
    setType(newType);
    setContent(TEMPLATES[newType] || '');
    // Set default provider for type
    const providers = TYPE_PROVIDERS[newType];
    if (providers?.length) setProvider(providers[0].value);
    setGenerated(false);
  };

  const handleGenerate = async () => {
    if (!aiPrompt.trim()) { setError('Describe what you need'); return; }
    setGenerating(true);
    setError(null);
    try {
      const res = await generateAsset(type, name || 'untitled', aiPrompt);
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
    if (!name.trim()) { setError('Name is required'); return; }
    if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$|^[a-z0-9]$/.test(name)) {
      setError('Name must be kebab-case (lowercase, hyphens, no spaces)');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await createAsset({ name, type, content, provider, scope });
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
            {(['skill', 'agent', 'mcp', 'rule', 'instruction'] as AssetType[]).map((t) => (
              <button
                key={t}
                onClick={() => handleTypeChange(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  type === t ? 'bg-accent/15 text-accent border border-accent/30' : 'bg-surface2 text-muted border border-border hover:text-text'
                }`}
              >
                {t === 'skill' ? '⚡ Skill' : t === 'agent' ? '🤖 Agent' : t === 'mcp' ? '🔌 MCP' : t === 'rule' ? '📏 Rule' : '📋 Instruction'}
              </button>
            ))}
          </div>

          {/* Name */}
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
            placeholder={type === 'instruction' ? 'filename (e.g. CLAUDE.md)' : 'asset-name (kebab-case)'}
            className="w-full bg-bg border border-border rounded-lg px-4 py-2 text-sm text-text font-mono placeholder:text-muted focus:outline-none focus:border-accent"
          />

          {/* Provider selection */}
          {providers.length > 1 && (
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
          )}

          {/* Scope: global vs project */}
          {(type === 'skill' || type === 'agent') && (
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-muted uppercase tracking-wider">Scope:</span>
              <button
                onClick={() => setScope('global')}
                className={`px-2 py-1 rounded text-xs ${scope === 'global' ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text'}`}
              >
                Global (~/.claude/)
              </button>
              <button
                onClick={() => setScope('project')}
                className={`px-2 py-1 rounded text-xs ${scope === 'project' ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text'}`}
              >
                Project-local (.claude/)
              </button>
            </div>
          )}

          {error && <div className="text-xs text-red">{error}</div>}
        </div>

        {/* Mode tabs: Manual / AI Generate */}
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
          {generated && (
            <span className="px-2 py-1.5 text-[10px] text-green self-center">✓ AI generated — review & edit below</span>
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
              placeholder="File content..."
            />
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-muted">
                Describe what you need and AI will generate the {type} for you.
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
                    : 'e.g. "Instructions for a Python FastAPI project with PostgreSQL, Redis, and Celery."'
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
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-border shrink-0">
          <button onClick={onClose} className="text-sm text-muted hover:text-text">Cancel</button>
          <button
            onClick={handleCreate}
            disabled={creating || !name.trim() || (mode === 'ai' && !generated)}
            className="px-4 py-2 text-sm font-medium bg-accent text-bg rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-40"
          >
            {creating ? 'Creating...' : `Create ${type}`}
          </button>
        </div>
      </div>
    </div>
  );
}
