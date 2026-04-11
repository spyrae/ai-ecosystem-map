'use strict';

const fs = require('fs');

function makeIssue(level, code, message) {
  return { level, code, message };
}

function validateMcpConfig(rawConfig, issues) {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    issues.push(makeIssue('blocking', 'missing_config', 'MCP entry has no readable config payload.'));
    return;
  }

  if (!rawConfig.command && !rawConfig.url) {
    issues.push(makeIssue('blocking', 'missing_transport', 'MCP config must define either "command" or "url".'));
  }

  if (rawConfig.command && typeof rawConfig.command !== 'string') {
    issues.push(makeIssue('blocking', 'invalid_command', 'MCP "command" must be a string.'));
  }

  if (rawConfig.url) {
    if (typeof rawConfig.url !== 'string') {
      issues.push(makeIssue('blocking', 'invalid_url', 'MCP "url" must be a string.'));
    } else {
      try {
        // Validate obvious malformed URLs early.
        new URL(rawConfig.url);
      } catch {
        issues.push(makeIssue('blocking', 'invalid_url', 'MCP "url" is not a valid absolute URL.'));
      }
    }
  }

  if (rawConfig.args && !Array.isArray(rawConfig.args)) {
    issues.push(makeIssue('blocking', 'invalid_args', 'MCP "args" must be an array when present.'));
  }
}

function evaluateAssetHealth(asset, options = {}) {
  const issues = [];
  const isLocalEnvironment = options.isLocalEnvironment !== false;
  const filePath = asset.filePath || '';

  if (!asset.providers || asset.providers.length === 0) {
    issues.push(makeIssue('warning', 'missing_providers', 'Asset has no detected providers.'));
  }

  if (asset.type === 'mcp') {
    validateMcpConfig(asset.rawConfig, issues);
  }

  if (isLocalEnvironment) {
    if (!filePath) {
      issues.push(makeIssue('blocking', 'missing_path', 'Asset has no resolved source path.'));
    } else {
      let stat;
      try {
        stat = fs.lstatSync(filePath);
      } catch {
        issues.push(makeIssue('blocking', 'missing_file', 'Asset source path no longer exists on disk.'));
        stat = null;
      }

      if (!stat) {
        // Continue to other validations if the path is gone.
      } else {
        if (stat.isSymbolicLink()) {
          try {
            fs.realpathSync(filePath);
          } catch {
            issues.push(makeIssue('blocking', 'broken_symlink', 'Asset points to a broken symlink target.'));
          }
        }

        if (stat.isFile() && stat.size === 0 && asset.type !== 'mcp') {
          issues.push(makeIssue('warning', 'empty_file', 'Asset file is empty.'));
        }
      }
    }
  }

  const hasBlocking = issues.some((entry) => entry.level === 'blocking');
  const status = hasBlocking ? 'broken' : issues.length > 0 ? 'warning' : 'ok';
  const summary = hasBlocking
    ? issues.find((entry) => entry.level === 'blocking')?.message
    : issues[0]?.message || 'No known issues.';

  return {
    status,
    issueCount: issues.length,
    hasBlocking,
    summary,
    issues,
  };
}

module.exports = {
  evaluateAssetHealth,
};
