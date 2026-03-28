'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./parser');

const HOME = process.env.HOME || process.env.USERPROFILE || '';

/**
 * AI provider definitions — what each tool uses and where configs live
 */
const PROVIDERS = {
  claude:   { name: 'Claude',   color: '#d4a0ff', letter: 'C', configDir: '.claude' },
  codex:    { name: 'Codex',    color: '#10a37f', letter: 'X', configDir: '.codex' },
  gemini:   { name: 'Gemini',   color: '#4285f4', letter: 'G', configDir: '.gemini' },
  cursor:   { name: 'Cursor',   color: '#00d4aa', letter: 'U', configDir: '.cursor' },
  windsurf: { name: 'Windsurf', color: '#06b6d4', letter: 'W', configDir: '.windsurf' },
  copilot:  { name: 'Copilot',  color: '#8b949e', letter: 'P', configDir: '.github' },
  continue_dev: { name: 'Continue', color: '#f97316', letter: 'N', configDir: '.continue' },
};

/**
 * Recursively find all .md files in a directory
 */
function findMdFiles(dir, prefix = '') {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return results; }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const subPrefix = prefix ? `${prefix}:${entry.name}` : entry.name;
      results.push(...findMdFiles(fullPath, subPrefix));
    } else if (entry.name.endsWith('.md')) {
      const baseName = entry.name.replace(/\.md$/, '');
      if (['INDEX', 'README', 'EXAMPLES', 'QUICK-REFERENCE', 'AGENTS', 'CHANGELOG'].includes(baseName)) continue;

      const name = prefix ? `${prefix}:${baseName}` : baseName;
      results.push({ name, filePath: fullPath });
    }
  }

  return results;
}

/**
 * Parse a single instruction file (AGENTS.md, GEMINI.md, etc.)
 */
function parseInstructionFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  const firstLine = extractFirstLine(content);
  const name = path.basename(filePath, '.md');
  return {
    name: name.toLowerCase(),
    desc: firstLine || `Instructions file: ${name}`,
    content,
  };
}

/**
 * Read MCP config from various locations
 */
function scanMcpServers(searchPaths) {
  const servers = [];
  const seen = new Set();

  for (const { mcpPath, providers } of searchPaths) {
    if (!fs.existsSync(mcpPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
      const mcpServers = raw.mcpServers || raw.servers || {};
      for (const [name, config] of Object.entries(mcpServers)) {
        if (seen.has(name)) {
          // Add providers to existing
          const existing = servers.find(s => s.name === name);
          if (existing) providers.forEach(p => { if (!existing.providers.includes(p)) existing.providers.push(p); });
          continue;
        }
        seen.add(name);
        servers.push({
          name,
          desc: config.description || `MCP server: ${name}`,
          type: 'mcp',
          transport: config.type || 'stdio',
          command: config.command || '',
          providers: [...providers],
        });
      }
    } catch { /* skip invalid json */ }
  }

  return servers;
}

/**
 * Main scanner — discovers everything across all AI tools
 */
function scanner(primaryDir) {
  const skills = [];
  const agents = [];
  const instructions = [];
  const rules = [];

  // Determine project root and home
  const isHomeConfig = primaryDir.startsWith(HOME);
  const projectRoot = isHomeConfig ? process.cwd() : path.dirname(primaryDir);

  // ═══════════════════════════════════════════
  // 1. CLAUDE CODE
  // ═══════════════════════════════════════════
  const claudeDir = primaryDir; // Primary scan target

  // Skills (commands/)
  const commandsDir = path.join(claudeDir, 'commands');
  if (fs.existsSync(commandsDir)) {
    for (const { name, filePath } of findMdFiles(commandsDir)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseFrontmatter(content);
      // Claude skills are also readable by Codex and Gemini CLI (shared format)
      skills.push({
        name: parsed.name || name,
        desc: parsed.description || extractFirstLine(content),
        type: 'skill',
        providers: ['claude', 'codex', 'gemini'],
        filePath,
        source: 'claude',
      });
    }
  }

  // Agents
  const agentsDir = path.join(claudeDir, 'agents');
  if (fs.existsSync(agentsDir)) {
    for (const { name, filePath } of findMdFiles(agentsDir)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseFrontmatter(content);
      agents.push({
        name: parsed.name || name,
        desc: parsed.description || extractFirstLine(content),
        type: 'agent',
        providers: ['claude'],
        filePath,
        source: 'claude',
      });
    }
  }

  // ═══════════════════════════════════════════
  // 2. CODEX CLI (OpenAI)
  // ═══════════════════════════════════════════
  const codexDir = path.join(HOME, '.codex');
  if (fs.existsSync(codexDir)) {
    // Codex instructions
    const codexInstr = path.join(codexDir, 'instructions.md');
    if (fs.existsSync(codexInstr)) {
      instructions.push({
        name: 'codex-instructions',
        desc: extractFirstLine(fs.readFileSync(codexInstr, 'utf-8')) || 'Codex global instructions',
        type: 'instruction',
        providers: ['codex'],
        source: 'codex',
      });
    }
  }
  // Project-level AGENTS.md (Codex + Copilot + Cursor + Windsurf)
  const agentsMd = path.join(projectRoot, 'AGENTS.md');
  if (fs.existsSync(agentsMd)) {
    instructions.push({
      name: 'AGENTS.md',
      desc: extractFirstLine(fs.readFileSync(agentsMd, 'utf-8')) || 'Cross-IDE agent instructions',
      type: 'instruction',
      providers: ['codex', 'copilot', 'cursor', 'windsurf'],
      source: 'shared',
    });
  }

  // ═══════════════════════════════════════════
  // 3. GEMINI CLI
  // ═══════════════════════════════════════════
  const geminiDir = path.join(HOME, '.gemini');
  if (fs.existsSync(geminiDir)) {
    // Gemini settings/instructions
    for (const fname of ['instructions.md', 'GEMINI.md']) {
      const fpath = path.join(geminiDir, fname);
      if (fs.existsSync(fpath)) {
        instructions.push({
          name: `gemini-${fname.replace('.md', '').toLowerCase()}`,
          desc: extractFirstLine(fs.readFileSync(fpath, 'utf-8')) || 'Gemini instructions',
          type: 'instruction',
          providers: ['gemini'],
          source: 'gemini',
        });
      }
    }
  }
  // Project-level GEMINI.md
  const geminiMd = path.join(projectRoot, 'GEMINI.md');
  if (fs.existsSync(geminiMd)) {
    instructions.push({
      name: 'GEMINI.md',
      desc: extractFirstLine(fs.readFileSync(geminiMd, 'utf-8')) || 'Gemini project instructions',
      type: 'instruction',
      providers: ['gemini'],
      source: 'gemini',
    });
  }

  // ═══════════════════════════════════════════
  // 4. CURSOR
  // ═══════════════════════════════════════════
  const cursorDir = path.join(projectRoot, '.cursor');
  if (fs.existsSync(cursorDir)) {
    const cursorRulesDir = path.join(cursorDir, 'rules');
    if (fs.existsSync(cursorRulesDir)) {
      for (const { name, filePath } of findMdFiles(cursorRulesDir)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseFrontmatter(content);
        rules.push({
          name: parsed.name || name,
          desc: parsed.description || extractFirstLine(content) || `Cursor rule: ${name}`,
          type: 'rule',
          providers: ['cursor'],
          source: 'cursor',
        });
      }
    }
  }
  // .cursorrules file
  const cursorrules = path.join(projectRoot, '.cursorrules');
  if (fs.existsSync(cursorrules)) {
    rules.push({
      name: '.cursorrules',
      desc: extractFirstLine(fs.readFileSync(cursorrules, 'utf-8')) || 'Cursor rules file',
      type: 'rule',
      providers: ['cursor'],
      source: 'cursor',
    });
  }

  // ═══════════════════════════════════════════
  // 5. WINDSURF
  // ═══════════════════════════════════════════
  const windsurfDir = path.join(projectRoot, '.windsurf');
  if (fs.existsSync(windsurfDir)) {
    const wsRulesDir = path.join(windsurfDir, 'rules');
    if (fs.existsSync(wsRulesDir)) {
      for (const { name, filePath } of findMdFiles(wsRulesDir)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseFrontmatter(content);
        rules.push({
          name: parsed.name || name,
          desc: parsed.description || extractFirstLine(content) || `Windsurf rule: ${name}`,
          type: 'rule',
          providers: ['windsurf'],
          source: 'windsurf',
        });
      }
    }
  }
  // .windsurfrules file
  const wsrules = path.join(projectRoot, '.windsurfrules');
  if (fs.existsSync(wsrules)) {
    rules.push({
      name: '.windsurfrules',
      desc: extractFirstLine(fs.readFileSync(wsrules, 'utf-8')) || 'Windsurf rules file',
      type: 'rule',
      providers: ['windsurf'],
      source: 'windsurf',
    });
  }

  // ═══════════════════════════════════════════
  // 6. GITHUB COPILOT
  // ═══════════════════════════════════════════
  const copilotInstr = path.join(projectRoot, '.github', 'copilot-instructions.md');
  if (fs.existsSync(copilotInstr)) {
    instructions.push({
      name: 'copilot-instructions',
      desc: extractFirstLine(fs.readFileSync(copilotInstr, 'utf-8')) || 'GitHub Copilot instructions',
      type: 'instruction',
      providers: ['copilot'],
      source: 'copilot',
    });
  }

  // ═══════════════════════════════════════════
  // 7. CONTINUE.DEV
  // ═══════════════════════════════════════════
  const continueDir = path.join(HOME, '.continue');
  if (fs.existsSync(continueDir)) {
    const configPath = path.join(continueDir, 'config.json');
    if (fs.existsSync(configPath)) {
      instructions.push({
        name: 'continue-config',
        desc: 'Continue.dev configuration',
        type: 'instruction',
        providers: ['continue_dev'],
        source: 'continue',
      });
    }
  }

  // ═══════════════════════════════════════════
  // 8. MCP SERVERS (multi-source)
  // ═══════════════════════════════════════════
  const mcpSearchPaths = [
    { mcpPath: path.join(claudeDir, '.mcp.json'), providers: ['claude'] },
    { mcpPath: path.join(claudeDir, 'mcp.json'), providers: ['claude'] },
    { mcpPath: path.join(projectRoot, '.mcp.json'), providers: ['claude', 'cursor'] },
    { mcpPath: path.join(projectRoot, 'mcp.json'), providers: ['claude', 'cursor'] },
    { mcpPath: path.join(HOME, '.continue', 'config.json'), providers: ['continue_dev'] },
  ];
  const mcpServers = scanMcpServers(mcpSearchPaths);

  return { skills, agents, mcpServers, instructions, rules, providers: PROVIDERS };
}

function extractFirstLine(content) {
  let inFrontmatter = false;
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.trim() === '---') { inFrontmatter = !inFrontmatter; continue; }
    if (inFrontmatter) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    return trimmed.substring(0, 200);
  }
  return '';
}

module.exports = { scanner, PROVIDERS };
