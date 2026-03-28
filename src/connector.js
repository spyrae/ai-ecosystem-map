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
  },
  codex: {
    skills: path.join(HOME, '.codex', 'skills', 'public'),
  },
  gemini: {
    skills: path.join(HOME, '.gemini', 'skills'),
  },
  cursor: {
    rules: null, // project-level only, needs project root
  },
  windsurf: {
    rules: null, // project-level only
  },
};

/**
 * Get the file extension mapping — what format each tool expects
 */
function getTargetPath(tool, itemType, itemName, projectRoot) {
  const fileName = itemName.replace(/:/g, '--') + '.md';

  switch (tool) {
    case 'claude':
      if (itemType === 'skill') return path.join(TOOL_TARGETS.claude.skills, fileName);
      if (itemType === 'agent') return path.join(TOOL_TARGETS.claude.agents, fileName);
      break;
    case 'codex':
      if (itemType === 'skill') return path.join(TOOL_TARGETS.codex.skills, fileName);
      break;
    case 'gemini':
      if (itemType === 'skill') return path.join(TOOL_TARGETS.gemini.skills, fileName);
      break;
    case 'cursor':
      if (projectRoot && (itemType === 'skill' || itemType === 'rule')) {
        return path.join(projectRoot, '.cursor', 'rules', fileName);
      }
      break;
    case 'windsurf':
      if (projectRoot && (itemType === 'skill' || itemType === 'rule')) {
        return path.join(projectRoot, '.windsurf', 'rules', fileName);
      }
      break;
  }
  return null;
}

/**
 * Connect: create symlink from source to target tool
 */
function connect(sourcePath, tool, itemType, itemName, projectRoot) {
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

  for (const tool of Object.keys(TOOL_TARGETS)) {
    const targetPath = getTargetPath(tool, itemType, itemName, projectRoot);
    if (!targetPath) {
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

module.exports = { connect, disconnect, getConnections, availableTools, TOOL_TARGETS };
