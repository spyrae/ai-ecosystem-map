'use strict';

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || process.env.USERPROFILE || '';

/**
 * Target directories for each AI tool.
 * Skills/agents get symlinked into these paths.
 */
const TOOL_TARGETS = {
  claude: {
    skills: path.join(HOME, '.claude', 'commands'),
    agents: path.join(HOME, '.claude', 'agents'),
    mcp: path.join(HOME, '.claude'), // .mcp.json
  },
  codex: {
    skills: path.join(HOME, '.codex', 'skills', 'public'),
    agents: path.join(HOME, '.codex', 'agents'),
  },
  gemini: {
    skills: path.join(HOME, '.gemini', 'skills'),
  },
  cursor: {
    rules: null, // project-level only, needs project root
    mcp: null,   // project-level .mcp.json
  },
  windsurf: {
    rules: null, // project-level only
  },
  copilot: {},
  continue_dev: {
    mcp: path.join(HOME, '.continue'), // config.json
  },
};

/**
 * Get the file extension mapping — what format each tool expects
 */
function getTargetPath(tool, itemType, itemName, projectRoot) {
  const fileName = itemName.replace(/:/g, '--') + '.md';
  const targets = TOOL_TARGETS[tool];
  if (!targets) return null;

  if (itemType === 'skill') {
    if (targets.skills) return path.join(targets.skills, fileName);
    // Cursor/Windsurf: skills go to rules dir (project-level)
    if (tool === 'cursor' && projectRoot) return path.join(projectRoot, '.cursor', 'rules', fileName);
    if (tool === 'windsurf' && projectRoot) return path.join(projectRoot, '.windsurf', 'rules', fileName);
  }

  if (itemType === 'agent') {
    if (targets.agents) return path.join(targets.agents, fileName);
  }

  if (itemType === 'rule') {
    if (tool === 'cursor' && projectRoot) return path.join(projectRoot, '.cursor', 'rules', fileName);
    if (tool === 'windsurf' && projectRoot) return path.join(projectRoot, '.windsurf', 'rules', fileName);
  }

  // MCP servers are handled differently (JSON config, not file copy)
  if (itemType === 'mcp') return '__mcp__';

  return null;
}

/**
 * Add MCP server entry to a tool's config JSON
 */
function connectMcp(serverName, serverConfig, tool, projectRoot) {
  let configPath;
  if (tool === 'claude') configPath = path.join(HOME, '.claude', '.mcp.json');
  else if (tool === 'cursor' && projectRoot) configPath = path.join(projectRoot, '.mcp.json');
  else if (tool === 'continue_dev') configPath = path.join(HOME, '.continue', 'config.json');
  else return { ok: false, error: `${tool} doesn't support MCP server management` };

  let config = {};
  if (fs.existsSync(configPath)) {
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); }
    catch { config = {}; }
  }

  const key = tool === 'continue_dev' ? 'servers' : 'mcpServers';
  if (!config[key]) config[key] = {};

  if (config[key][serverName]) {
    return { ok: true, message: 'Already connected' };
  }

  config[key][serverName] = serverConfig;

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  return { ok: true, message: `MCP server added to ${tool}`, configPath };
}

/**
 * Remove MCP server entry from a tool's config JSON
 */
function disconnectMcp(serverName, tool, projectRoot) {
  let configPath;
  if (tool === 'claude') configPath = path.join(HOME, '.claude', '.mcp.json');
  else if (tool === 'cursor' && projectRoot) configPath = path.join(projectRoot, '.mcp.json');
  else if (tool === 'continue_dev') configPath = path.join(HOME, '.continue', 'config.json');
  else return { ok: false, error: `${tool} doesn't support MCP` };

  if (!fs.existsSync(configPath)) {
    return { ok: true, message: 'Already disconnected' };
  }

  let config;
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); }
  catch { return { ok: false, error: 'Invalid config JSON' }; }

  const key = tool === 'continue_dev' ? 'servers' : 'mcpServers';
  if (config[key] && config[key][serverName]) {
    delete config[key][serverName];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { ok: true, message: `MCP server removed from ${tool}` };
  }

  return { ok: true, message: 'Already disconnected' };
}

/**
 * Connect: create symlink from source to target tool
 */
function connect(sourcePath, tool, itemType, itemName, projectRoot, mcpConfig) {
  // MCP servers use JSON config, not file copy
  if (itemType === 'mcp') {
    return connectMcp(itemName, mcpConfig || {}, tool, projectRoot);
  }

  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { ok: false, error: `Source not found: ${sourcePath}` };
  }

  const targetPath = getTargetPath(tool, itemType, itemName, projectRoot);
  if (!targetPath) {
    return { ok: false, error: `${tool} doesn't support ${itemType} type` };
  }

  // Create target directory if needed
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Check if already exists
  if (fs.existsSync(targetPath)) {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      const existing = fs.readlinkSync(targetPath);
      if (existing === sourcePath) {
        return { ok: true, message: 'Already connected', targetPath };
      }
    }
    return { ok: false, error: `File already exists at ${targetPath}` };
  }

  // Create symlink
  try {
    fs.symlinkSync(sourcePath, targetPath, 'file');
    return { ok: true, message: `Connected to ${tool}`, targetPath, method: 'symlink' };
  } catch (symlinkError) {
    // Fallback: copy file (Windows without dev mode can't symlink)
    try {
      fs.copyFileSync(sourcePath, targetPath);
      return { ok: true, message: `Connected to ${tool} (copied)`, targetPath, method: 'copy' };
    } catch (copyError) {
      return { ok: false, error: `Failed: ${copyError.message}` };
    }
  }
}

/**
 * Disconnect: remove symlink/copy from target tool
 */
function disconnect(tool, itemType, itemName, projectRoot) {
  if (itemType === 'mcp') {
    return disconnectMcp(itemName, tool, projectRoot);
  }

  const targetPath = getTargetPath(tool, itemType, itemName, projectRoot);
  if (!targetPath) {
    return { ok: false, error: `${tool} doesn't support ${itemType} type` };
  }

  if (!fs.existsSync(targetPath)) {
    return { ok: true, message: 'Already disconnected' };
  }

  try {
    fs.unlinkSync(targetPath);
    return { ok: true, message: `Disconnected from ${tool}` };
  } catch (err) {
    return { ok: false, error: `Failed to remove: ${err.message}` };
  }
}

/**
 * Check which tools an item is currently connected to
 */
function getConnections(sourcePath, itemType, itemName, projectRoot) {
  const connections = {};
  const MCP_TOOLS = ['claude', 'cursor', 'continue_dev'];

  for (const tool of Object.keys(TOOL_TARGETS)) {
    // MCP servers: check JSON config
    if (itemType === 'mcp') {
      if (!MCP_TOOLS.includes(tool)) {
        connections[tool] = { supported: false };
        continue;
      }
      let configPath;
      if (tool === 'claude') configPath = path.join(HOME, '.claude', '.mcp.json');
      else if (tool === 'cursor' && projectRoot) configPath = path.join(projectRoot, '.mcp.json');
      else if (tool === 'continue_dev') configPath = path.join(HOME, '.continue', 'config.json');
      else { connections[tool] = { supported: false }; continue; }

      if (!fs.existsSync(configPath)) {
        connections[tool] = { supported: true, connected: false };
        continue;
      }
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const key = tool === 'continue_dev' ? 'servers' : 'mcpServers';
        const connected = !!(config[key] && config[key][itemName]);
        connections[tool] = { supported: true, connected, isSymlink: false };
      } catch {
        connections[tool] = { supported: true, connected: false };
      }
      continue;
    }

    // Skills, agents, rules: check file existence
    const targetPath = getTargetPath(tool, itemType, itemName, projectRoot);
    if (!targetPath || targetPath === '__mcp__') {
      connections[tool] = { supported: false };
      continue;
    }

    if (!fs.existsSync(targetPath)) {
      connections[tool] = { supported: true, connected: false };
      continue;
    }

    const stat = fs.lstatSync(targetPath);
    connections[tool] = {
      supported: true,
      connected: true,
      isSymlink: stat.isSymbolicLink(),
      targetPath,
    };
  }

  return connections;
}

/**
 * List all available tools that support a given item type
 */
function availableTools(itemType) {
  const tools = [];
  for (const [tool, dirs] of Object.entries(TOOL_TARGETS)) {
    if (itemType === 'skill' && dirs.skills !== undefined) tools.push(tool);
    if (itemType === 'agent' && dirs.agents !== undefined) tools.push(tool);
    if (itemType === 'rule' && dirs.rules !== undefined) tools.push(tool);
  }
  return tools;
}

module.exports = { connect, disconnect, getConnections, connectMcp, disconnectMcp, availableTools, TOOL_TARGETS };
