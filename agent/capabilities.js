'use strict';

const path = require('path');
const { ALL_TOOLS, getConnections } = require('./connector');

const PROVIDER_LABELS = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  copilot: 'GitHub Copilot',
  continue_dev: 'Continue',
};

function createLocations(asset) {
  if (asset.locations && typeof asset.locations === 'object') {
    return { ...asset.locations };
  }
  if (!asset.filePath) return {};
  return Object.fromEntries((asset.providers || []).map((provider) => [provider, asset.filePath]));
}

function describeUnsupported(asset, tool) {
  const label = PROVIDER_LABELS[tool] || tool;
  if ((asset.type === 'rule' || asset.type === 'instruction') && !asset.projectPath) {
    return `${label} supports this asset only inside a project context.`;
  }
  return `${label} does not support ${asset.type} assets in this context.`;
}

function summarizeProviders(providers) {
  return providers.reduce((summary, provider) => {
    const state = provider.state;
    summary.total += 1;
    summary[state] = (summary[state] || 0) + 1;
    return summary;
  }, {
    total: 0,
    active: 0,
    configured: 0,
    available: 0,
    missing: 0,
    unsupported: 0,
    invalid: 0,
  });
}

function buildCapabilities(asset, options = {}) {
  const locations = createLocations(asset);
  const projectRoot = options.projectRoot || asset.projectPath || null;
  const connections = options.connections || getConnections(
    asset.filePath || null,
    asset.type,
    asset.name,
    projectRoot,
    locations
  );
  const invalidSummary = asset.health?.summary || 'Blocking issues prevent this asset from being used safely.';

  const providers = ALL_TOOLS.map((tool) => {
    const connection = connections[tool] || {
      installed: false,
      supported: false,
      connected: false,
    };
    const installed = connection.installed !== false;
    const supported = connection.supported !== false;

    let state = 'available';
    let detail = 'Available as a target for this asset.';

    if (connection.isSource) {
      state = asset.health?.hasBlocking ? 'invalid' : 'active';
      detail = asset.health?.hasBlocking ? invalidSummary : 'This provider is the source/original location of the asset.';
    } else if (connection.connected) {
      state = asset.health?.hasBlocking ? 'invalid' : 'configured';
      detail = asset.health?.hasBlocking
        ? invalidSummary
        : connection.isSymlink
          ? 'Connected via symlink.'
          : 'Connected via copied or merged config.';
    } else if (!supported) {
      state = 'unsupported';
      detail = describeUnsupported(asset, tool);
    } else if (!installed) {
      state = 'missing';
      detail = `${PROVIDER_LABELS[tool] || tool} is not installed on this machine.`;
    } else if (asset.health?.hasBlocking) {
      state = 'invalid';
      detail = invalidSummary;
    }

    return {
      provider: tool,
      label: PROVIDER_LABELS[tool] || tool,
      state,
      installed,
      supported,
      connected: Boolean(connection.connected),
      isSource: Boolean(connection.isSource),
      isSymlink: Boolean(connection.isSymlink),
      targetPath: connection.targetPath || null,
      detail,
    };
  });

  return {
    summary: summarizeProviders(providers),
    providers,
  };
}

function attachCapabilities(asset, options = {}) {
  return {
    ...asset,
    capabilities: buildCapabilities(asset, options),
  };
}

function attachCapabilitiesToAssets(assets, options = {}) {
  return assets.map((asset) => attachCapabilities(asset, options));
}

module.exports = {
  buildCapabilities,
  attachCapabilities,
  attachCapabilitiesToAssets,
};
