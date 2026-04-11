'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const { evaluateAssetHealth } = require('./health');
const { attachCapabilities } = require('./capabilities');

const HOME = process.env.HOME || process.env.USERPROFILE || '';

function stableProjectAssetId(projectPath, type, name, filePath = '', environmentId = 'local') {
  return crypto
    .createHash('sha1')
    .update(`${environmentId}:${projectPath}:${type}:${name}:${filePath}`)
    .digest('hex')
    .slice(0, 12);
}

/**
 * Known config markers that indicate a project uses AI tools
 */
const AI_MARKERS = [
  '.claude',
  '.cursor',
  '.windsurf',
  '.github/copilot-instructions.md',
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  '.cursorrules',
  '.windsurfrules',
  '.mcp.json',
];

/**
 * Detect which AI tools a project uses based on marker files
 */
function detectProjectProviders(projectPath) {
  const providers = new Set();

  const checks = [
    { paths: ['.claude', 'CLAUDE.md'], provider: 'claude' },
    { paths: ['AGENTS.md'], provider: 'codex' },
    { paths: ['GEMINI.md'], provider: 'gemini' },
    { paths: ['.cursor', '.cursorrules'], provider: 'cursor' },
    { paths: ['.windsurf', '.windsurfrules'], provider: 'windsurf' },
    { paths: ['.github/copilot-instructions.md'], provider: 'copilot' },
  ];

  for (const { paths: markerPaths, provider } of checks) {
    for (const p of markerPaths) {
      if (fs.existsSync(path.join(projectPath, p))) {
        providers.add(provider);
        break;
      }
    }
  }

  return [...providers];
}

/**
 * Scan a single project directory for local AI assets
 */
function scanProjectAssets(projectPath, options = {}) {
  const { parseFrontmatter } = require('./parser');
  const assets = [];
  const projectName = path.basename(projectPath);
  const environmentId = options.environmentId || 'local';
  const environmentType = options.environmentType || 'local';
  const pushAsset = (asset) => {
    const normalized = {
      id: stableProjectAssetId(projectPath, asset.type, asset.name, asset.filePath || '', environmentId),
      environment_id: environmentId,
      environment_type: environmentType,
      ...asset,
    };
    assets.push(attachCapabilities({
      ...normalized,
      health: evaluateAssetHealth(normalized, { isLocalEnvironment: true }),
    }, { projectRoot: projectPath }));
  };

  // Local .claude/commands/ (project-level skills)
  const localCommands = path.join(projectPath, '.claude', 'commands');
  if (fs.existsSync(localCommands)) {
    for (const file of findMdFilesFlat(localCommands)) {
      const content = fs.readFileSync(file.path, 'utf-8');
      const parsed = parseFrontmatter(content);
      pushAsset({
        name: parsed.name || file.name,
        desc: parsed.description || extractFirstLine(content),
        type: 'skill',
        scope: 'project',
        projectPath,
        projectName,
        filePath: file.path,
        providers: ['claude', 'codex', 'gemini'],
      });
    }
  }

  // Local .claude/agents/
  const localAgents = path.join(projectPath, '.claude', 'agents');
  if (fs.existsSync(localAgents)) {
    for (const file of findMdFilesFlat(localAgents)) {
      const content = fs.readFileSync(file.path, 'utf-8');
      const parsed = parseFrontmatter(content);
      pushAsset({
        name: parsed.name || file.name,
        desc: parsed.description || extractFirstLine(content),
        type: 'agent',
        scope: 'project',
        projectPath,
        projectName,
        filePath: file.path,
        providers: ['claude'],
      });
    }
  }

  // Local .claude/rules/
  const claudeRules = path.join(projectPath, '.claude', 'rules');
  if (fs.existsSync(claudeRules)) {
    for (const file of findMdFilesFlat(claudeRules)) {
      const content = fs.readFileSync(file.path, 'utf-8');
      const parsed = parseFrontmatter(content);
      pushAsset({
        name: parsed.name || file.name,
        desc: parsed.description || extractFirstLine(content),
        type: 'rule',
        scope: 'project',
        projectPath,
        projectName,
        filePath: file.path,
        providers: ['claude'],
      });
    }
  }

  // Local .cursor/rules/
  const cursorRules = path.join(projectPath, '.cursor', 'rules');
  if (fs.existsSync(cursorRules)) {
    for (const file of findMdFilesFlat(cursorRules)) {
      const content = fs.readFileSync(file.path, 'utf-8');
      const parsed = parseFrontmatter(content);
      pushAsset({
        name: parsed.name || file.name,
        desc: parsed.description || extractFirstLine(content),
        type: 'rule',
        scope: 'project',
        projectPath,
        projectName,
        filePath: file.path,
        providers: ['cursor'],
      });
    }
  }

  // Local .windsurf/rules/
  const wsRules = path.join(projectPath, '.windsurf', 'rules');
  if (fs.existsSync(wsRules)) {
    for (const file of findMdFilesFlat(wsRules)) {
      const content = fs.readFileSync(file.path, 'utf-8');
      const parsed = parseFrontmatter(content);
      pushAsset({
        name: parsed.name || file.name,
        desc: parsed.description || extractFirstLine(content),
        type: 'rule',
        scope: 'project',
        projectPath,
        projectName,
        filePath: file.path,
        providers: ['windsurf'],
      });
    }
  }

  // Local .mcp.json (project-level MCP)
  const localMcp = path.join(projectPath, '.mcp.json');
  if (fs.existsSync(localMcp)) {
    try {
      const raw = JSON.parse(fs.readFileSync(localMcp, 'utf-8'));
      const servers = raw.mcpServers || raw.servers || {};
      for (const [name, config] of Object.entries(servers)) {
        pushAsset({
          name,
          desc: config.description || `MCP server: ${name}`,
          type: 'mcp',
          scope: 'project',
          projectPath,
          projectName,
          filePath: localMcp,
          rawConfig: config,
          providers: ['claude', 'cursor'],
          locations: {
            claude: localMcp,
            cursor: localMcp,
          },
        });
      }
    } catch { /* skip */ }
  }

  // Instruction files
  const instrFiles = [
    { file: 'CLAUDE.md', providers: ['claude'] },
    { file: 'AGENTS.md', providers: ['codex', 'copilot', 'cursor', 'windsurf'] },
    { file: 'GEMINI.md', providers: ['gemini'] },
    { file: '.cursorrules', providers: ['cursor'] },
    { file: '.windsurfrules', providers: ['windsurf'] },
    { file: '.github/copilot-instructions.md', providers: ['copilot'] },
  ];

  for (const { file, providers } of instrFiles) {
    const fp = path.join(projectPath, file);
    if (fs.existsSync(fp)) {
      pushAsset({
        name: file.replace(/^\./, '').replace(/\.md$/, '').toLowerCase(),
        desc: extractFirstLine(fs.readFileSync(fp, 'utf-8')) || `${file} instructions`,
        type: 'instruction',
        scope: 'project',
        projectPath,
        projectName,
        filePath: fp,
        providers,
      });
    }
  }

  return assets;
}

/**
 * Discover projects in given directories
 */
function discoverProjects(searchDirs) {
  const projects = [];
  const seen = new Set();

  for (let dir of searchDirs) {
    // Resolve ~ to home directory
    if (dir.startsWith('~')) {
      dir = dir.replace('~', HOME);
    }
    if (!fs.existsSync(dir)) continue;

    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const projectPath = path.join(dir, entry.name);
      if (seen.has(projectPath)) continue;

      // Check if this looks like a project with AI tooling
      const hasMarker = AI_MARKERS.some(marker =>
        fs.existsSync(path.join(projectPath, marker))
      );

      if (hasMarker) {
        seen.add(projectPath);
        const providers = detectProjectProviders(projectPath);
        const assets = scanProjectAssets(projectPath);

        projects.push({
          path: projectPath,
          name: entry.name,
          providers,
          assetCount: assets.length,
          assets,
        });
      }
    }
  }

  return projects;
}

/**
 * Add a specific project by path
 */
function addProjectByPath(projectPath) {
  if (!fs.existsSync(projectPath)) return null;

  const providers = detectProjectProviders(projectPath);
  const assets = scanProjectAssets(projectPath);

  return {
    path: projectPath,
    name: path.basename(projectPath),
    providers,
    assetCount: assets.length,
    assets,
  };
}

// ─── Helpers ────────────────────────────────────────

function findMdFilesFlat(dir, prefix = '') {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return results; }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const sub = prefix ? `${prefix}:${entry.name}` : entry.name;
      results.push(...findMdFilesFlat(fullPath, sub));
    } else if (entry.name.endsWith('.md')) {
      const base = entry.name.replace(/\.md$/, '');
      if (['INDEX', 'README', 'EXAMPLES', 'QUICK-REFERENCE', 'CHANGELOG'].includes(base)) continue;
      results.push({
        name: prefix ? `${prefix}:${base}` : base,
        path: fullPath,
      });
    }
  }

  return results;
}

function extractFirstLine(content) {
  let inFrontmatter = false;
  for (const line of content.split('\n')) {
    if (line.trim() === '---') { inFrontmatter = !inFrontmatter; continue; }
    if (inFrontmatter) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    return trimmed.substring(0, 200);
  }
  return '';
}

module.exports = { discoverProjects, addProjectByPath, scanProjectAssets, detectProjectProviders };
