'use strict';

const crypto = require('crypto');
const mcpClient = require('./mcp-client');

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const runtimeCache = new Map();

function fingerprintAsset(asset) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify({
      id: asset?.id || null,
      type: asset?.type || null,
      environment_id: asset?.environment_id || null,
      environment_type: asset?.environment_type || null,
      filePath: asset?.filePath || null,
      rawConfig: asset?.rawConfig || null,
    }))
    .digest('hex');
}

function createUnknownRuntime(asset) {
  return {
    transport: mcpClient.inferTransport(asset?.rawConfig || {}),
    status: 'unknown',
    reachable: false,
    phase: 'idle',
    reasonCode: 'not_checked',
    summary: 'Runtime check has not been run yet.',
    details: ['Run a runtime check to verify reachability, handshake, and tools listing.'],
    checkedAt: null,
    durationMs: null,
    toolCount: null,
    tools: [],
    cached: false,
    stale: false,
  };
}

function getCachedRuntime(asset, options = {}) {
  if (!asset || asset.type !== 'mcp') return null;

  const ttlMs = typeof options.ttlMs === 'number' ? options.ttlMs : DEFAULT_TTL_MS;
  const fingerprint = fingerprintAsset(asset);
  const cached = runtimeCache.get(asset.id);
  if (!cached || cached.fingerprint !== fingerprint) {
    return createUnknownRuntime(asset);
  }

  const stale = Date.now() - cached.checkedAtMs > ttlMs;
  return {
    ...cached.result,
    cached: true,
    stale,
  };
}

function setCachedRuntime(asset, result) {
  if (!asset?.id || asset.type !== 'mcp') return result;

  runtimeCache.set(asset.id, {
    fingerprint: fingerprintAsset(asset),
    checkedAtMs: Date.now(),
    result: {
      ...result,
      cached: false,
      stale: false,
    },
  });

  return result;
}

async function checkMcpRuntime(asset, options = {}) {
  if (!asset || asset.type !== 'mcp') return null;

  const force = Boolean(options.force);
  const cached = getCachedRuntime(asset, options);
  if (!force && cached && cached.status !== 'unknown' && !cached.stale) {
    return cached;
  }

  const transport = mcpClient.inferTransport(asset.rawConfig || {});
  if ((asset.environment_type === 'remote' || asset.environmentType === 'remote') && transport === 'stdio') {
    return setCachedRuntime(asset, {
      transport,
      status: 'warning',
      reachable: false,
      phase: 'preflight',
      reasonCode: 'remote_stdio_unsupported',
      summary: 'Remote stdio MCP runtime checks are not supported from this machine yet.',
      details: [
        'The asset lives on a remote environment and uses stdio transport.',
        'A remote SSH-backed runtime launcher is not implemented yet, so reachability cannot be verified automatically.',
      ],
      checkedAt: new Date().toISOString(),
      durationMs: 0,
      toolCount: null,
      tools: [],
      cached: false,
      stale: false,
    });
  }

  const result = await mcpClient.runMcpDiagnostics(asset.rawConfig || {}, options);
  return setCachedRuntime(asset, result);
}

function clearCachedRuntime(assetId) {
  if (!assetId) return;
  runtimeCache.delete(assetId);
}

module.exports = {
  getCachedRuntime,
  checkMcpRuntime,
  clearCachedRuntime,
};
