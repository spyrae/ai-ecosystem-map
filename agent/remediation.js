'use strict';

const { assetMatchesRule } = require('./policies');
const { inferProviderFromAsset } = require('./pathing');

function createSuggestion(payload) {
  return {
    id: payload.id,
    category: payload.category || 'health',
    action: payload.action,
    title: payload.title,
    summary: payload.summary,
    details: payload.details || [],
    applyLabel: payload.applyLabel || null,
    canApply: Boolean(payload.canApply),
    risky: Boolean(payload.risky),
    issueCodes: payload.issueCodes || [],
    syncRequest: payload.syncRequest || null,
    sourceAssetId: payload.sourceAssetId || null,
  };
}

function buildRuleFromViolation(violation) {
  return {
    mode: violation.mode,
    assetType: violation.assetType,
    scope: violation.scope,
    name: violation.name || null,
    namePattern: violation.namePattern || null,
    provider: violation.provider || null,
  };
}

function dedupeAssets(assets) {
  const seen = new Set();
  const unique = [];
  for (const asset of assets || []) {
    if (!asset?.id || seen.has(asset.id)) continue;
    seen.add(asset.id);
    unique.push(asset);
  }
  return unique;
}

async function enrichSyncSuggestion(suggestion, previewSyncRequest) {
  if (!suggestion.syncRequest || typeof previewSyncRequest !== 'function') {
    return suggestion;
  }

  try {
    const preview = await previewSyncRequest(suggestion.syncRequest);
    const changed = (preview.operations || []).filter((operation) => operation.action !== 'noop');
    const previewIssues = (preview.issues || []).map((issue) => issue.message);
    return {
      ...suggestion,
      canApply: Boolean(preview.canApply && changed.length > 0),
      risky: suggestion.risky || changed.some((operation) => operation.action === 'update'),
      summary: changed[0]?.summary || suggestion.summary,
      details: previewIssues.length > 0 ? [...suggestion.details, ...previewIssues] : suggestion.details,
      issueCodes: [...new Set([
        ...suggestion.issueCodes,
        ...(preview.issues || []).map((issue) => issue.code),
      ])],
    };
  } catch (err) {
    return {
      ...suggestion,
      canApply: false,
      details: [...suggestion.details, err.message || 'Unable to preview remediation'],
    };
  }
}

async function buildAssetRemediations(asset, opts) {
  const suggestions = [];
  const codes = (asset?.health?.issues || []).map((issue) => issue.code);
  const blockingMcpCodes = ['missing_config', 'missing_transport', 'invalid_command', 'invalid_url', 'invalid_args'];

  if (asset?.type === 'mcp') {
    if (!codes.some((code) => blockingMcpCodes.includes(code))) {
      const runtimeStatus = asset.runtime?.status || 'unknown';
      if (!asset.runtime || runtimeStatus === 'warning' || runtimeStatus === 'broken' || runtimeStatus === 'unknown') {
        suggestions.push(createSuggestion({
          id: 'runtime-check',
          category: 'runtime',
          action: 'runtime_check',
          title: 'Run MCP runtime check',
          summary: asset.runtime?.summary || 'Validate handshake and tools for this MCP server.',
          details: asset.runtime?.details || [],
          applyLabel: 'Run Check',
          canApply: true,
          issueCodes: codes.filter((code) => code.startsWith('runtime_')),
        }));
      }
    }

    const invalidCodes = codes.filter((code) => blockingMcpCodes.includes(code));
    if (invalidCodes.length > 0) {
      suggestions.push(createSuggestion({
        id: 'guided-mcp-fix',
        category: 'health',
        action: 'guided_mcp_fix',
        title: 'Fix MCP configuration manually',
        summary: asset.health?.summary || 'This MCP configuration is incomplete or invalid and needs manual correction.',
        details: (asset.health?.issues || []).filter((issue) => invalidCodes.includes(issue.code)).map((issue) => issue.message),
        issueCodes: invalidCodes,
      }));
    }
  }

  if (asset?.drift) {
    const group = opts.driftGraph?.groups?.find((entry) => entry.key === asset.drift.groupKey);
    const sourceMember = group?.members?.find((member) => member.assetId === asset.drift.sourceAssetId || member.sourceOfTruth);
    if (!asset.drift.isSourceOfTruth && sourceMember) {
      const sourceAsset = await opts.resolveAssetById(sourceMember.assetId, asset.type);
      suggestions.push(createSuggestion({
        id: 'repair-from-source',
        category: 'drift',
        action: 'repair_from_source',
        title: codes.includes('broken_symlink') ? 'Recreate link from source of truth' : 'Repair from source of truth',
        summary: `Restore ${asset.name} using ${sourceMember.locationLabel}.`,
        details: [
          sourceMember.summary,
          sourceAsset?.filePath ? `Source: ${sourceAsset.filePath}` : 'Source asset content will be read from the current source of truth.',
        ],
        applyLabel: codes.includes('broken_symlink') ? 'Repair Link' : 'Repair',
        canApply: Boolean(sourceAsset && asset.filePath),
        risky: asset.drift.status === 'drifted',
        issueCodes: codes,
        sourceAssetId: sourceMember.assetId,
      }));
    } else if (!asset.drift.isSourceOfTruth && asset.drift.sourceMode === 'missing') {
      suggestions.push(createSuggestion({
        id: 'promote-source-of-truth',
        category: 'drift',
        action: 'promote_source_of_truth',
        title: 'Promote this copy to source of truth',
        summary: 'The current source of truth is missing. Promote this copy to re-anchor future sync and drift checks.',
        details: ['This updates source-of-truth metadata only; no files are changed.'],
        applyLabel: 'Promote',
        canApply: true,
        issueCodes: codes,
      }));
    }
  }

  return suggestions;
}

async function buildProjectRemediations(project, opts) {
  const policy = opts.policyStatus;
  if (!policy || !policy.violations?.length) return [];

  const suggestions = [];
  const localCandidates = dedupeAssets(opts.localCandidates);
  for (const violation of policy.violations) {
    if (violation.mode === 'forbidden') {
      suggestions.push(createSuggestion({
        id: `guided-forbidden:${violation.id}`,
        category: 'policy',
        action: 'guided_fix',
        title: `Remove forbidden ${violation.assetType}`,
        summary: violation.message,
        details: violation.matchedAssets?.map((asset) => `${asset.name}${asset.filePath ? ` · ${asset.filePath}` : ''}`) || [],
        issueCodes: ['forbidden_asset'],
      }));
      continue;
    }

    if (project.environment_type === 'remote') {
      suggestions.push(createSuggestion({
        id: `guided-remote:${violation.id}`,
        category: 'policy',
        action: 'guided_fix',
        title: `Resolve missing ${violation.assetType} in remote project`,
        summary: violation.message,
        details: ['Remote project remediation is not automated yet. Add the asset directly in the remote project or implement remote project sync first.'],
        issueCodes: ['remote_project_sync_missing'],
      }));
      continue;
    }

    const rule = buildRuleFromViolation(violation);
    const candidates = localCandidates.filter((candidate) => assetMatchesRule(rule, candidate));
    if (candidates.length === 1) {
      const candidate = candidates[0];
      const suggestion = await enrichSyncSuggestion(createSuggestion({
        id: `sync-project:${violation.id}`,
        category: 'policy',
        action: 'sync_missing_asset',
        title: `Copy ${candidate.name} into ${project.name}`,
        summary: violation.message,
        details: [
          `Source: ${candidate.filePath || candidate.name}`,
          `Target project: ${project.path}`,
        ],
        applyLabel: 'Apply Fix',
        canApply: true,
        issueCodes: ['missing_required_asset'],
        syncRequest: {
          source: {
            assetId: candidate.id,
            name: candidate.name,
            type: candidate.type,
            filePath: candidate.filePath || null,
            providers: candidate.providers || [],
            rawConfig: candidate.rawConfig || null,
            projectPath: candidate.projectPath || null,
          },
          target: {
            kind: 'project',
            projectPath: project.path,
            method: 'copy',
          },
        },
      }), opts.previewSyncRequest);
      suggestions.push(suggestion);
      continue;
    }

    suggestions.push(createSuggestion({
      id: `guided-project:${violation.id}`,
      category: 'policy',
      action: 'guided_fix',
      title: `Resolve missing ${violation.assetType} in ${project.name}`,
      summary: violation.message,
      details: candidates.length > 1
        ? [`Multiple matching local assets found: ${candidates.map((candidate) => candidate.name).join(', ')}`]
        : ['No matching local source asset was found. Create it first or pick a source manually.'],
      issueCodes: ['missing_required_asset'],
    }));
  }

  return suggestions;
}

async function buildEnvironmentRemediations(environment, opts) {
  const policy = opts.policyStatus;
  if (!policy || !policy.violations?.length) return [];

  const suggestions = [];
  const localCandidates = dedupeAssets(opts.localCandidates);
  for (const violation of policy.violations) {
    if (violation.mode === 'forbidden') {
      suggestions.push(createSuggestion({
        id: `guided-forbidden:${violation.id}`,
        category: 'policy',
        action: 'guided_fix',
        title: `Remove forbidden ${violation.assetType}`,
        summary: violation.message,
        details: violation.matchedAssets?.map((asset) => `${asset.name}${asset.filePath ? ` · ${asset.filePath}` : ''}`) || [],
        issueCodes: ['forbidden_asset'],
      }));
      continue;
    }

    const rule = buildRuleFromViolation(violation);
    const candidates = localCandidates.filter((candidate) => assetMatchesRule(rule, candidate));
    if (candidates.length !== 1) {
      suggestions.push(createSuggestion({
        id: `guided-environment:${violation.id}`,
        category: 'policy',
        action: 'guided_fix',
        title: `Resolve missing ${violation.assetType} in ${environment.name}`,
        summary: violation.message,
        details: candidates.length > 1
          ? [`Multiple matching local assets found: ${candidates.map((candidate) => candidate.name).join(', ')}`]
          : ['No matching local source asset was found. Create it first or pick a source manually.'],
        issueCodes: ['missing_required_asset'],
      }));
      continue;
    }

    const candidate = candidates[0];
    if (environment.type === 'remote') {
      const suggestion = await enrichSyncSuggestion(createSuggestion({
        id: `sync-server:${violation.id}`,
        category: 'policy',
        action: 'sync_missing_asset',
        title: `Push ${candidate.name} to ${environment.name}`,
        summary: violation.message,
        details: [
          `Source: ${candidate.filePath || candidate.name}`,
          `Target server: ${environment.name}`,
        ],
        applyLabel: 'Apply Fix',
        canApply: true,
        issueCodes: ['missing_required_asset'],
        syncRequest: {
          source: {
            assetId: candidate.id,
            name: candidate.name,
            type: candidate.type,
            filePath: candidate.filePath || null,
            providers: candidate.providers || [],
            rawConfig: candidate.rawConfig || null,
            projectPath: candidate.projectPath || null,
          },
          target: {
            kind: 'server',
            serverId: environment.id,
            direction: 'push',
          },
        },
      }), opts.previewSyncRequest);
      suggestions.push(suggestion);
      continue;
    }

    const provider = violation.provider || inferProviderFromAsset(candidate) || null;
    if (!provider) {
      suggestions.push(createSuggestion({
        id: `guided-provider:${violation.id}`,
        category: 'policy',
        action: 'guided_fix',
        title: `Resolve missing ${violation.assetType} in ${environment.name}`,
        summary: violation.message,
        details: ['A target provider could not be determined automatically for this environment remediation.'],
        issueCodes: ['provider_undetermined'],
      }));
      continue;
    }

    const suggestion = await enrichSyncSuggestion(createSuggestion({
      id: `sync-provider:${violation.id}`,
      category: 'policy',
      action: 'sync_missing_asset',
      title: `Configure ${candidate.name} for ${provider}`,
      summary: violation.message,
      details: [
        `Source: ${candidate.filePath || candidate.name}`,
        `Target provider: ${provider}`,
      ],
      applyLabel: 'Apply Fix',
      canApply: true,
      issueCodes: ['missing_required_asset'],
      syncRequest: {
        source: {
          assetId: candidate.id,
          name: candidate.name,
          type: candidate.type,
          filePath: candidate.filePath || null,
          providers: candidate.providers || [],
          rawConfig: candidate.rawConfig || null,
          projectPath: candidate.projectPath || null,
        },
        target: {
          kind: 'provider',
          provider,
        },
      },
    }), opts.previewSyncRequest);
    suggestions.push(suggestion);
  }

  return suggestions;
}

module.exports = {
  buildAssetRemediations,
  buildProjectRemediations,
  buildEnvironmentRemediations,
};
