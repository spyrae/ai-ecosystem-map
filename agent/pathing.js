'use strict';

const path = require('path');

function inferProviderFromAsset(asset, fallbackProvider = null) {
  if (!asset) return fallbackProvider;
  const filePath = asset.filePath || '';
  if (filePath.includes(`${path.sep}.codex${path.sep}`) || filePath.endsWith(`${path.sep}AGENTS.md`)) return 'codex';
  if (filePath.includes(`${path.sep}.gemini${path.sep}`) || filePath.endsWith(`${path.sep}GEMINI.md`)) return 'gemini';
  if (filePath.includes(`${path.sep}.cursor${path.sep}`) || filePath.endsWith(`${path.sep}.cursorrules`)) return 'cursor';
  if (filePath.includes(`${path.sep}.windsurf${path.sep}`) || filePath.endsWith(`${path.sep}.windsurfrules`)) return 'windsurf';
  if (filePath.includes(`${path.sep}.github${path.sep}`)) return 'copilot';
  if (filePath.includes(`${path.sep}.continue${path.sep}`)) return 'continue_dev';
  if (filePath.includes(`${path.sep}.claude${path.sep}`) || filePath.endsWith(`${path.sep}CLAUDE.md`)) return 'claude';
  return fallbackProvider || asset.providers?.[0] || 'claude';
}

function inferRemoteTargetPath(home, asset) {
  const fileName = asset.filePath ? path.basename(asset.filePath) : `${asset.name}.md`;
  const provider = inferProviderFromAsset(asset);
  const normalized = asset.filePath || '';

  if (asset.type === 'skill') {
    if (provider === 'codex') return `${home}/.codex/skills/public/${fileName}`;
    if (provider === 'gemini') return `${home}/.gemini/skills/${fileName}`;
    return `${home}/.claude/commands/${fileName}`;
  }

  if (asset.type === 'agent') {
    if (provider === 'codex') return `${home}/.codex/agents/${fileName}`;
    return `${home}/.claude/agents/${fileName}`;
  }

  if (asset.type === 'rule') {
    if (fileName === '.cursorrules') return `${home}/.cursorrules`;
    if (fileName === '.windsurfrules') return `${home}/.windsurfrules`;
    if (provider === 'cursor') return `${home}/.cursor/rules/${fileName}`;
    if (provider === 'windsurf') return `${home}/.windsurf/rules/${fileName}`;
    return `${home}/.claude/rules/${fileName}`;
  }

  if (asset.type === 'instruction') {
    if (normalized.includes(`${path.sep}.claude${path.sep}`)) return `${home}/.claude/CLAUDE.md`;
    if (normalized.includes(`${path.sep}.codex${path.sep}`)) return `${home}/.codex/instructions.md`;
    if (normalized.includes(`${path.sep}.gemini${path.sep}`)) return `${home}/.gemini/instructions.md`;
    if (normalized.includes(`${path.sep}.github${path.sep}`)) return `${home}/.github/copilot-instructions.md`;
    if (normalized.includes(`${path.sep}.continue${path.sep}`)) return `${home}/.continue/config.json`;
    if (fileName === 'CLAUDE.md') return `${home}/CLAUDE.md`;
    if (fileName === 'AGENTS.md') return `${home}/AGENTS.md`;
    if (fileName === 'GEMINI.md') return `${home}/GEMINI.md`;
    if (fileName === '.cursorrules') return `${home}/.cursorrules`;
    if (fileName === '.windsurfrules') return `${home}/.windsurfrules`;
    if (fileName === 'copilot-instructions.md') return `${home}/.github/copilot-instructions.md`;
    if (provider === 'claude') return `${home}/.claude/CLAUDE.md`;
    if (provider === 'codex') return `${home}/.codex/instructions.md`;
    if (provider === 'gemini') return `${home}/.gemini/instructions.md`;
    if (provider === 'cursor') return `${home}/.cursorrules`;
    if (provider === 'windsurf') return `${home}/.windsurfrules`;
    if (provider === 'copilot') return `${home}/.github/copilot-instructions.md`;
    if (provider === 'continue_dev') return `${home}/.continue/config.json`;
  }

  if (asset.type === 'mcp') {
    if (provider === 'codex') return `${home}/.codex/mcp.json`;
    if (provider === 'gemini') return `${home}/.gemini/mcp.json`;
    if (provider === 'windsurf') return `${home}/.windsurf/mcp.json`;
    if (provider === 'continue_dev') return `${home}/.continue/config.json`;
    return `${home}/.claude/.mcp.json`;
  }

  return null;
}

function inferLocalTargetPath(asset, projectRoot) {
  const HOME = process.env.HOME || '';
  const localProjectRoot = projectRoot || process.cwd();
  const fileName = asset.filePath ? path.basename(asset.filePath) : `${asset.name}.md`;
  const provider = inferProviderFromAsset(asset);
  const normalized = asset.filePath || '';

  if (asset.type === 'skill') {
    if (provider === 'codex') return path.join(HOME, '.codex', 'skills', 'public', fileName);
    if (provider === 'gemini') return path.join(HOME, '.gemini', 'skills', fileName);
    return path.join(HOME, '.claude', 'commands', fileName);
  }

  if (asset.type === 'agent') {
    if (provider === 'codex') return path.join(HOME, '.codex', 'agents', fileName);
    return path.join(HOME, '.claude', 'agents', fileName);
  }

  if (asset.type === 'rule') {
    if (fileName === '.cursorrules') return path.join(localProjectRoot, '.cursorrules');
    if (fileName === '.windsurfrules') return path.join(localProjectRoot, '.windsurfrules');
    if (provider === 'cursor') return path.join(localProjectRoot, '.cursor', 'rules', fileName);
    if (provider === 'windsurf') return path.join(localProjectRoot, '.windsurf', 'rules', fileName);
    return path.join(HOME, '.claude', 'rules', fileName);
  }

  if (asset.type === 'instruction') {
    if (normalized.includes(`${path.sep}.claude${path.sep}`)) return path.join(HOME, '.claude', 'CLAUDE.md');
    if (normalized.includes(`${path.sep}.codex${path.sep}`)) return path.join(HOME, '.codex', 'instructions.md');
    if (normalized.includes(`${path.sep}.gemini${path.sep}`)) return path.join(HOME, '.gemini', 'instructions.md');
    if (normalized.includes(`${path.sep}.github${path.sep}`)) return path.join(localProjectRoot, '.github', 'copilot-instructions.md');
    if (normalized.includes(`${path.sep}.continue${path.sep}`)) return path.join(HOME, '.continue', 'config.json');
    if (fileName === 'CLAUDE.md') return path.join(localProjectRoot, 'CLAUDE.md');
    if (fileName === 'AGENTS.md') return path.join(localProjectRoot, 'AGENTS.md');
    if (fileName === 'GEMINI.md') return path.join(localProjectRoot, 'GEMINI.md');
    if (fileName === '.cursorrules') return path.join(localProjectRoot, '.cursorrules');
    if (fileName === '.windsurfrules') return path.join(localProjectRoot, '.windsurfrules');
    if (fileName === 'copilot-instructions.md') return path.join(localProjectRoot, '.github', 'copilot-instructions.md');
    if (provider === 'claude') return path.join(HOME, '.claude', 'CLAUDE.md');
    if (provider === 'codex') return path.join(HOME, '.codex', 'instructions.md');
    if (provider === 'gemini') return path.join(HOME, '.gemini', 'instructions.md');
    if (provider === 'copilot') return path.join(localProjectRoot, '.github', 'copilot-instructions.md');
    if (provider === 'continue_dev') return path.join(HOME, '.continue', 'config.json');
  }

  if (asset.type === 'mcp') {
    if (provider === 'codex') return path.join(HOME, '.codex', 'mcp.json');
    if (provider === 'gemini') return path.join(HOME, '.gemini', 'mcp.json');
    if (provider === 'windsurf') return path.join(HOME, '.windsurf', 'mcp.json');
    if (provider === 'continue_dev') return path.join(HOME, '.continue', 'config.json');
    return path.join(HOME, '.claude', '.mcp.json');
  }

  return null;
}

function inferProjectAssetTarget(sourcePath, targetProjectPath, type, providerHint = null) {
  const normalized = sourcePath ? path.normalize(sourcePath) : '';
  const fileName = sourcePath ? path.basename(sourcePath) : null;
  const providerFromPath =
    normalized.includes(`${path.sep}.cursor${path.sep}`) ? 'cursor' :
      normalized.includes(`${path.sep}.windsurf${path.sep}`) ? 'windsurf' :
        normalized.includes(`${path.sep}.github${path.sep}`) ? 'copilot' :
          normalized.includes(`${path.sep}.claude${path.sep}`) ? 'claude' :
            providerHint;

  if (type === 'skill') return path.join(targetProjectPath, '.claude', 'commands', fileName || 'skill.md');
  if (type === 'agent') return path.join(targetProjectPath, '.claude', 'agents', fileName || 'agent.md');

  if (type === 'rule') {
    if (providerFromPath === 'cursor') return path.join(targetProjectPath, '.cursor', 'rules', fileName || 'rule.md');
    if (providerFromPath === 'windsurf') return path.join(targetProjectPath, '.windsurf', 'rules', fileName || 'rule.md');
    return path.join(targetProjectPath, '.claude', 'rules', fileName || 'rule.md');
  }

  if (type === 'instruction') {
    if (providerFromPath === 'claude') return path.join(targetProjectPath, 'CLAUDE.md');
    if (providerFromPath === 'gemini') return path.join(targetProjectPath, 'GEMINI.md');
    if (providerFromPath === 'cursor') return path.join(targetProjectPath, '.cursorrules');
    if (providerFromPath === 'windsurf') return path.join(targetProjectPath, '.windsurfrules');
    if (providerFromPath === 'copilot') return path.join(targetProjectPath, '.github', 'copilot-instructions.md');
    return path.join(targetProjectPath, 'AGENTS.md');
  }

  return null;
}

module.exports = {
  inferProviderFromAsset,
  inferRemoteTargetPath,
  inferLocalTargetPath,
  inferProjectAssetTarget,
};
