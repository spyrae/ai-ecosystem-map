'use strict';

const fs = require('fs');
const { connect, disconnect } = require('./connector');
const { evaluateAssetHealth } = require('./health');
const { inferProviderFromAsset } = require('./pathing');
const sync = require('./sync');

function itemKey(input, source) {
  if (source?.id) return source.id;
  if (input?.assetId) return input.assetId;
  return `${input?.type || source?.type || 'asset'}:${input?.name || source?.name || 'unknown'}`;
}

function itemSummary(input, source, extra = {}) {
  return {
    id: itemKey(input, source),
    name: source?.name || input?.name || 'unknown',
    type: source?.type || input?.type || 'unknown',
    filePath: source?.filePath || input?.filePath || null,
    ...extra,
  };
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function resolveAssetInput(input, opts) {
  if (!input || (!input.assetId && !input.name && !input.filePath)) return null;
  const indexed = opts.resolveAsset?.(input.assetId || input.name, input.type || null);
  if (indexed) return indexed;

  return {
    id: input.assetId || `${input.type}:${input.name}`,
    name: input.name,
    type: input.type,
    filePath: input.filePath || null,
    providers: Array.isArray(input.providers) ? input.providers : [],
    rawConfig: input.rawConfig || null,
    locations: input.locations || null,
    projectPath: input.projectPath || null,
  };
}

function enrichMcpAsset(asset) {
  if (!asset || asset.type !== 'mcp' || asset.rawConfig || !asset.filePath) return asset;
  const provider = inferProviderFromAsset(asset);
  const doc = readJson(asset.filePath);
  const key = provider === 'continue_dev' ? 'servers' : (doc.mcpServers ? 'mcpServers' : 'servers');
  return {
    ...asset,
    rawConfig: doc?.[key]?.[asset.name] || null,
  };
}

function summarizeResults(results) {
  return results.reduce((summary, entry) => {
    if (entry.ok) summary.successCount += 1;
    else summary.failureCount += 1;
    return summary;
  }, { total: results.length, successCount: 0, failureCount: 0 });
}

function validateBatch(body, opts) {
  const items = Array.isArray(body?.items) ? body.items : [];
  const results = items.map((input) => {
    const source = enrichMcpAsset(resolveAssetInput(input, opts));
    if (!source) {
      return itemSummary(input, null, { ok: false, error: 'Asset not found' });
    }

    const health = evaluateAssetHealth(source, {
      isLocalEnvironment: input.scope !== 'remote',
    });

    return itemSummary(input, source, {
      ok: true,
      health,
      status: health.status,
    });
  });

  const summary = results.reduce((acc, entry) => {
    if (!entry.ok) {
      acc.failureCount += 1;
      return acc;
    }
    if (entry.status === 'broken') acc.brokenCount += 1;
    else if (entry.status === 'warning') acc.warningCount += 1;
    else acc.okCount += 1;
    return acc;
  }, { total: results.length, okCount: 0, warningCount: 0, brokenCount: 0, failureCount: 0 });

  return { ok: true, ...summary, results };
}

function connectBatch(body, opts) {
  const tool = body?.tool;
  const items = Array.isArray(body?.items) ? body.items : [];
  const results = items.map((input) => {
    const source = enrichMcpAsset(resolveAssetInput(input, opts));
    if (!tool) return itemSummary(input, source, { ok: false, error: 'Tool is required' });
    if (!source) return itemSummary(input, null, { ok: false, error: 'Asset not found' });

    const health = evaluateAssetHealth(source);
    if (health.hasBlocking) {
      return itemSummary(input, source, { ok: false, error: health.summary });
    }

    const result = connect(source.filePath, tool, source.type, source.name, opts.projectRoot, source.rawConfig);
    return itemSummary(input, source, {
      ok: Boolean(result.ok),
      method: result.method,
      message: result.message,
      error: result.ok ? undefined : result.error || 'Connect failed',
    });
  });

  return { ok: true, tool, ...summarizeResults(results), results };
}

function disconnectBatch(body, opts) {
  const tool = body?.tool;
  const items = Array.isArray(body?.items) ? body.items : [];
  const results = items.map((input) => {
    const source = resolveAssetInput(input, opts);
    if (!tool) return itemSummary(input, source, { ok: false, error: 'Tool is required' });
    if (!source) return itemSummary(input, null, { ok: false, error: 'Asset not found' });

    const result = disconnect(tool, source.type, source.name, opts.projectRoot);
    return itemSummary(input, source, {
      ok: Boolean(result.ok),
      message: result.message,
      error: result.ok ? undefined : result.error || 'Disconnect failed',
    });
  });

  return { ok: true, tool, ...summarizeResults(results), results };
}

function deleteOne(source) {
  if (source.type === 'mcp') {
    const mcpPaths = [
      ...new Set([
        ...Object.values(source.locations || {}).filter(Boolean),
        ...(source.filePath ? [source.filePath] : []),
      ]),
    ];
    let removed = false;
    for (const mcpPath of mcpPaths) {
      if (!fs.existsSync(mcpPath)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
        const key = raw.mcpServers ? 'mcpServers' : (raw.servers ? 'servers' : 'mcpServers');
        if (raw[key]?.[source.name]) {
          delete raw[key][source.name];
          fs.writeFileSync(mcpPath, JSON.stringify(raw, null, 2), 'utf-8');
          removed = true;
        }
      } catch {
        // Keep scanning other config locations.
      }
    }
    return removed
      ? { ok: true, message: 'Deleted MCP entry' }
      : { ok: false, error: 'MCP server not found in configs' };
  }

  if (!source.filePath) return { ok: false, error: 'Asset has no file path' };
  if (!fs.existsSync(source.filePath)) return { ok: false, error: 'Asset source file does not exist' };

  try {
    fs.unlinkSync(source.filePath);
    return { ok: true, message: 'Deleted asset file' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function deleteBatch(body, opts) {
  const items = Array.isArray(body?.items) ? body.items : [];
  const results = items.map((input) => {
    const source = resolveAssetInput(input, opts);
    if (!source) return itemSummary(input, null, { ok: false, error: 'Asset not found' });

    const health = evaluateAssetHealth(enrichMcpAsset(source));
    if (source.type !== 'mcp' && !source.filePath) {
      return itemSummary(input, source, { ok: false, error: 'Asset has no file path' });
    }
    if (source.type !== 'mcp' && health.issues.some((issue) => issue.code === 'missing_path')) {
      return itemSummary(input, source, { ok: false, error: 'Asset has no file path' });
    }

    const result = deleteOne(source);
    return itemSummary(input, source, {
      ok: Boolean(result.ok),
      message: result.message,
      error: result.ok ? undefined : result.error,
    });
  });

  return { ok: true, ...summarizeResults(results), results };
}

async function previewBatchSync(body, opts) {
  const requests = Array.isArray(body?.requests) ? body.requests : [];
  const results = [];

  let readyCount = 0;
  let blockedCount = 0;
  let hasChangesCount = 0;
  let operationCount = 0;

  for (const request of requests) {
    const sourceName = request?.source?.name || 'unknown';
    try {
      const plan = await sync.previewSync(request, opts);
      const hasBlockingIssues = plan.issues.some((entry) => entry.level === 'blocking');
      if (plan.canApply && !hasBlockingIssues) readyCount += 1;
      if (hasBlockingIssues || !plan.canApply) blockedCount += 1;
      if (plan.hasChanges) hasChangesCount += 1;
      operationCount += plan.operations.length;
      results.push({
        id: request.source?.assetId || `${request.source?.type}:${sourceName}`,
        name: sourceName,
        ok: true,
        plan,
      });
    } catch (err) {
      blockedCount += 1;
      results.push({
        id: request.source?.assetId || `${request.source?.type}:${sourceName}`,
        name: sourceName,
        ok: false,
        error: err.message,
      });
    }
  }

  return {
    ok: true,
    total: requests.length,
    readyCount,
    blockedCount,
    hasChangesCount,
    operationCount,
    results,
  };
}

async function applyBatchSync(body, opts) {
  const requests = Array.isArray(body?.requests) ? body.requests : [];
  const preview = await previewBatchSync(body, opts);
  const results = [];

  let appliedCount = 0;
  let skippedCount = 0;

  for (let index = 0; index < preview.results.length; index += 1) {
    const previewResult = preview.results[index];
    const request = requests[index];

    if (!previewResult.ok) {
      skippedCount += 1;
      results.push(previewResult);
      continue;
    }

    const plan = previewResult.plan;
    const hasBlockingIssues = plan.issues.some((entry) => entry.level === 'blocking');
    if (!plan.canApply || !plan.hasChanges || hasBlockingIssues) {
      skippedCount += 1;
      results.push({
        ...previewResult,
        ok: true,
        applied: 0,
        skipped: plan.operations.length,
        message: !plan.hasChanges ? 'Already up to date' : 'Blocked by preview issues',
      });
      continue;
    }

    try {
      const result = await sync.applySync(request, opts);
      if (result.ok) {
        appliedCount += result.applied || 0;
        skippedCount += result.skipped || 0;
        results.push({
          ...previewResult,
          ok: true,
          applied: result.applied || 0,
          skipped: result.skipped || 0,
        });
      } else {
        skippedCount += plan.operations.length;
        results.push({
          ...previewResult,
          ok: false,
          error: result.error || 'Batch sync failed',
        });
      }
    } catch (err) {
      skippedCount += plan.operations.length;
      results.push({
        ...previewResult,
        ok: false,
        error: err.message,
      });
    }
  }

  const batchSummary = summarizeResults(results);
  return {
    ok: true,
    total: requests.length,
    appliedCount,
    skippedCount,
    ...batchSummary,
    results,
  };
}

module.exports = {
  validateBatch,
  connectBatch,
  disconnectBatch,
  deleteBatch,
  previewBatchSync,
  applyBatchSync,
};
