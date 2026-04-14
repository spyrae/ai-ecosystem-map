'use strict';

const path = require('path');
const { compareAssets, semanticFingerprint } = require('./diff');

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

function driftGroupKey(asset) {
  return `${asset.type}:${normalizeName(asset.name)}`;
}

function toPlainAsset(asset, overrides = {}) {
  return {
    ...asset,
    ...overrides,
    tags: [...(asset.tags || [])],
    providers: [...(asset.providers || [])],
    deps: [...(asset.deps || [])],
  };
}

function inferScope(asset) {
  if (asset.projectPath && asset.environment_type === 'remote') return 'remote_project';
  if (asset.projectPath) return 'project';
  if (asset.environment_type === 'remote') return 'remote';
  return 'local';
}

function scopeRank(scope) {
  switch (scope) {
    case 'local':
      return 0;
    case 'project':
      return 1;
    case 'remote':
      return 2;
    case 'remote_project':
      return 3;
    default:
      return 4;
  }
}

function healthPenalty(asset) {
  const status = asset.health?.status || 'ok';
  if (status === 'broken') return 100;
  if (status === 'warning') return 10;
  return 0;
}

function filePathScore(filePath) {
  if (!filePath) return 50;
  if (filePath.endsWith('.mcp.json') || filePath.endsWith('mcp.json')) return 0;
  const base = path.basename(filePath).toLowerCase();
  if (base === 'claude.md' || base === 'agents.md' || base === 'gemini.md') return 1;
  return 5;
}

function compareMembers(a, b) {
  const scoreA = scopeRank(a.scope) * 1000 + healthPenalty(a.asset) + filePathScore(a.asset.filePath);
  const scoreB = scopeRank(b.scope) * 1000 + healthPenalty(b.asset) + filePathScore(b.asset.filePath);
  if (scoreA !== scoreB) return scoreA - scoreB;
  return String(a.asset.filePath || a.asset.id).localeCompare(String(b.asset.filePath || b.asset.id));
}

function locationLabel(member) {
  const parts = [];
  if (member.scope === 'local') {
    parts.push('Local');
  } else if (member.scope === 'project') {
    parts.push('Project');
  } else if (member.scope === 'remote') {
    parts.push('Remote');
  } else if (member.scope === 'remote_project') {
    parts.push('Remote Project');
  }

  if (member.projectName) parts.push(member.projectName);
  else if (member.environmentName && member.scope !== 'local') parts.push(member.environmentName);

  return parts.join(' · ');
}

function memberSummary(member, sourceMember, reasonCodes) {
  if (member.status === 'source') {
    return sourceMember?.sourceMode === 'explicit'
      ? 'Explicit source of truth.'
      : 'Inferred source of truth.';
  }
  if (member.status === 'orphaned') {
    return 'Copy exists, but the stored source of truth is missing.';
  }
  if (member.status === 'synced') {
    return 'Matches the current source of truth.';
  }
  if (member.status === 'drifted') {
    if (reasonCodes.includes('content_changed')) return 'Content diverged from the source of truth.';
    if (reasonCodes.includes('providers_changed')) return 'Provider coverage diverged from the source of truth.';
    if (reasonCodes.includes('health_changed')) return 'Health state diverged from the source of truth.';
    return 'Differs from the source of truth.';
  }
  return '';
}

function groupSeverity(status, reasonCount) {
  if (status === 'orphaned') return 'high';
  if (status === 'drifted') return reasonCount > 1 ? 'high' : 'medium';
  if (status === 'synced') return 'low';
  return 'none';
}

async function collectAssets({ getData, store, scanProjectAssets, remote }) {
  const localAssets = (getData() || []).map((asset) => toPlainAsset(asset, {
    environment_id: asset.environment_id || store.getLocalEnvironmentId(),
    environment_type: 'local',
  }));

  const localEnvironmentId = store.getLocalEnvironmentId();
  const storedAssets = (store.getAssets() || [])
    .filter((asset) => asset.environment_id && asset.environment_id !== localEnvironmentId)
    .map((asset) => toPlainAsset(asset, {
      environment_type: 'remote',
    }));

  const projects = store.getProjects();
  const projectAssets = [];

  for (const project of projects) {
    if (project.environment_type === 'remote') {
      const environment = store.getEnvironments().find((entry) => entry.id === project.environment_id);
      if (!environment) continue;
      try {
        const assets = await remote.scanRemoteProjectAssets(environment, project.path);
        for (const asset of assets) {
          projectAssets.push(toPlainAsset(asset, {
            projectId: project.id,
            projectName: project.name,
            projectPath: project.path,
            environment_id: project.environment_id,
            environment_type: 'remote',
          }));
        }
      } catch {
        continue;
      }
    } else {
      const assets = scanProjectAssets(project.path, {
        environmentId: project.environment_id || localEnvironmentId,
        environmentType: 'local',
      });
      for (const asset of assets) {
        projectAssets.push(toPlainAsset(asset, {
          projectId: project.id,
          projectName: project.name,
          projectPath: project.path,
          environment_id: project.environment_id || localEnvironmentId,
          environment_type: 'local',
        }));
      }
    }
  }

  return [...localAssets, ...storedAssets, ...projectAssets];
}

function buildGroup(assetKey, members, sourceTruthMap, environmentsById) {
  const [type, ...nameParts] = assetKey.split(':');
  const name = nameParts.join(':');
  const sortedMembers = [...members].sort(compareMembers);
  const explicitSourceId = sourceTruthMap[assetKey] || null;
  const sourceMember = explicitSourceId
    ? sortedMembers.find((member) => member.asset.id === explicitSourceId) || null
    : sortedMembers[0] || null;
  const sourceMode = explicitSourceId
    ? (sourceMember ? 'explicit' : 'missing')
    : 'inferred';

  const memberSummaries = [];
  let reasonCount = 0;

  for (const member of sortedMembers) {
    const env = member.asset.environment_id ? environmentsById.get(member.asset.environment_id) : null;
    const base = {
      assetId: member.asset.id,
      name: member.asset.name,
      type: member.asset.type,
      filePath: member.asset.filePath || null,
      projectId: member.asset.projectId || null,
      projectName: member.asset.projectName || null,
      projectPath: member.asset.projectPath || null,
      environmentId: member.asset.environment_id || null,
      environmentName: env?.name || member.asset.environment_name || null,
      environmentType: member.asset.environment_type || env?.type || 'local',
      providers: [...(member.asset.providers || [])],
      health: member.asset.health || null,
      capabilities: member.asset.capabilities || null,
      scope: member.scope,
      locationLabel: locationLabel({
        scope: member.scope,
        projectName: member.asset.projectName,
        environmentName: env?.name || member.asset.environment_name,
      }),
      sourceOfTruth: Boolean(sourceMember && member.asset.id === sourceMember.asset.id && sourceMode !== 'missing'),
    };

    if (sourceMode === 'missing') {
      memberSummaries.push({
        ...base,
        status: 'orphaned',
        differsFromSource: true,
        reasons: [{ code: 'missing_source', message: 'The stored source of truth no longer exists.' }],
        summary: 'Copy exists, but the stored source of truth is missing.',
      });
      reasonCount += 1;
      continue;
    }

    if (sourceMember && member.asset.id === sourceMember.asset.id) {
      memberSummaries.push({
        ...base,
        status: 'source',
        differsFromSource: false,
        reasons: [],
        summary: sourceMode === 'explicit' ? 'Explicit source of truth.' : 'Inferred source of truth.',
      });
      continue;
    }

    const comparison = compareAssets(sourceMember.asset, member.asset);
    const reasonCodes = comparison.reasons.map((reason) => reason.code);
    reasonCount += comparison.reasons.length;

    memberSummaries.push({
      ...base,
      status: comparison.status === 'same' ? 'synced' : 'drifted',
      differsFromSource: comparison.status !== 'same',
      reasons: comparison.reasons,
      summary: memberSummary(member, { ...sourceMember, sourceMode }, reasonCodes),
    });
  }

  const groupStatus = sourceMode === 'missing'
    ? 'orphaned'
    : memberSummaries.some((member) => member.status === 'drifted')
      ? 'drifted'
      : memberSummaries.length > 1
        ? 'synced'
        : 'source';

  return {
    key: assetKey,
    name,
    type,
    status: groupStatus,
    severity: groupSeverity(groupStatus, reasonCount),
    summary: sourceMode === 'missing'
      ? 'Stored source of truth is missing; remaining copies are orphaned.'
      : groupStatus === 'drifted'
        ? `${memberSummaries.filter((member) => member.status === 'drifted').length} copy/copies diverged from the source of truth.`
        : groupStatus === 'synced'
          ? `All ${memberSummaries.length} copies match the current source of truth.`
          : 'Only one known copy exists.',
    copyCount: memberSummaries.length,
    sourceAssetId: sourceMember?.asset.id || explicitSourceId || null,
    sourceMode,
    members: memberSummaries,
  };
}

async function buildDriftGraph({ getData, store, scanProjectAssets, remote }) {
  const assets = await collectAssets({ getData, store, scanProjectAssets, remote });
  const groups = new Map();
  const sourceTruthMap = store.getSourceOfTruthMap ? store.getSourceOfTruthMap() : {};
  const environmentsById = new Map(store.getEnvironments().map((environment) => [environment.id, environment]));

  for (const asset of assets) {
    const key = driftGroupKey(asset);
    const member = {
      asset,
      scope: inferScope(asset),
      fingerprint: semanticFingerprint(asset),
    };
    const list = groups.get(key) || [];
    list.push(member);
    groups.set(key, list);
  }

  const driftGroups = [...groups.entries()]
    .map(([groupKey, members]) => buildGroup(groupKey, members, sourceTruthMap, environmentsById))
    .sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2, none: 3 };
      const severityDelta = (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4);
      if (severityDelta !== 0) return severityDelta;
      return a.name.localeCompare(b.name);
    });

  const byAssetId = {};
  for (const group of driftGroups) {
    for (const member of group.members) {
      byAssetId[member.assetId] = {
        groupKey: group.key,
        status: member.status,
        severity: group.severity,
        sourceAssetId: group.sourceAssetId,
        sourceMode: group.sourceMode,
        isSourceOfTruth: member.sourceOfTruth,
        summary: member.summary,
        copyCount: group.copyCount,
      };
    }
  }

  const summary = driftGroups.reduce((acc, group) => {
    acc.totalGroups += 1;
    acc.totalCopies += group.copyCount;
    if (group.status === 'drifted') acc.driftedGroups += 1;
    if (group.status === 'orphaned') acc.orphanedGroups += 1;
    if (group.status === 'synced') acc.syncedGroups += 1;
    if (group.status === 'source') acc.sourceGroups += 1;
    return acc;
  }, {
    totalGroups: 0,
    totalCopies: 0,
    driftedGroups: 0,
    orphanedGroups: 0,
    syncedGroups: 0,
    sourceGroups: 0,
  });

  return {
    groups: driftGroups,
    byAssetId,
    summary,
  };
}

module.exports = {
  buildDriftGraph,
  driftGroupKey,
};
