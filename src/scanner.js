'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./parser');

/**
 * Recursively find all .md files in a directory
 */
function findMdFiles(dir, prefix = '') {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const subPrefix = prefix ? `${prefix}:${entry.name}` : entry.name;
      results.push(...findMdFiles(fullPath, subPrefix));
    } else if (entry.name.endsWith('.md')) {
      const baseName = entry.name.replace(/\.md$/, '');
      // Skip meta files
      if (['INDEX', 'README', 'EXAMPLES', 'QUICK-REFERENCE', 'AGENTS'].includes(baseName)) continue;

      const name = prefix ? `${prefix}:${baseName}` : baseName;
      results.push({ name, filePath: fullPath });
    }
  }

  return results;
}

/**
 * Scan .claude/ directory for skills, agents, and MCP servers
 */
function scanner(claudeDir) {
  const skills = [];
  const agents = [];
  const mcpServers = [];

  // 1. Scan commands/ for skills
  const commandsDir = path.join(claudeDir, 'commands');
  if (fs.existsSync(commandsDir)) {
    const files = findMdFiles(commandsDir);
    for (const { name, filePath } of files) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseFrontmatter(content);
      skills.push({
        name: parsed.name || name,
        desc: parsed.description || extractFirstLine(content),
        type: 'skill',
        filePath,
        deps: parsed.deps || [],
        raw: parsed,
      });
    }
  }

  // 2. Scan agents/ for agents
  const agentsDir = path.join(claudeDir, 'agents');
  if (fs.existsSync(agentsDir)) {
    const files = findMdFiles(agentsDir);
    for (const { name, filePath } of files) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseFrontmatter(content);
      agents.push({
        name: parsed.name || name,
        desc: parsed.description || extractFirstLine(content),
        type: 'agent',
        filePath,
        raw: parsed,
      });
    }
  }

  // 3. Read .mcp.json for MCP servers
  const mcpPaths = [
    path.join(claudeDir, '.mcp.json'),
    path.join(claudeDir, 'mcp.json'),
  ];

  for (const mcpPath of mcpPaths) {
    if (fs.existsSync(mcpPath)) {
      try {
        const mcpConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
        const servers = mcpConfig.mcpServers || {};
        for (const [name, config] of Object.entries(servers)) {
          mcpServers.push({
            name,
            desc: config.description || `MCP server: ${name}`,
            type: 'mcp',
            transport: config.type || 'stdio',
            command: config.command || '',
            raw: config,
          });
        }
      } catch (e) {
        // Skip invalid JSON
      }
      break; // Use first found
    }
  }

  return { skills, agents, mcpServers };
}

function extractFirstLine(content) {
  // Skip frontmatter, find first meaningful line
  let inFrontmatter = false;
  const lines = content.split('\n');

  for (const line of lines) {
    if (line.trim() === '---') {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) continue;

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    return trimmed.substring(0, 200);
  }

  return '';
}

module.exports = { scanner };
