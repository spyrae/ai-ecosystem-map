'use strict';

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function semanticFingerprint(asset) {
  return stableStringify({
    type: asset.type,
    name: asset.name,
    desc: asset.desc || '',
    cat: asset.cat || '',
    tags: [...(asset.tags || [])].sort(),
    deps: [...(asset.deps || [])].sort(),
    isOrchestrator: Boolean(asset.isOrchestrator),
    rawConfig: asset.rawConfig || null,
  });
}

function providerFingerprint(asset) {
  return stableStringify([...(asset.providers || [])].sort());
}

function healthFingerprint(asset) {
  const health = asset.health || null;
  return stableStringify({
    status: health?.status || 'ok',
    hasBlocking: Boolean(health?.hasBlocking),
    codes: (health?.issues || []).map((issue) => issue.code).sort(),
  });
}

function diffPair(local, remote) {
  const reasons = [];

  if (semanticFingerprint(local) !== semanticFingerprint(remote)) {
    reasons.push({ code: 'content_changed', message: 'Content or asset metadata differs between local and remote.' });
  }

  if (providerFingerprint(local) !== providerFingerprint(remote)) {
    reasons.push({ code: 'providers_changed', message: 'Provider availability differs between local and remote.' });
  }

  if (healthFingerprint(local) !== healthFingerprint(remote)) {
    reasons.push({ code: 'health_changed', message: 'Health state differs between local and remote.' });
  }

  const status = reasons.length > 0 ? 'drifted' : 'same';
  const summary = status === 'same'
    ? 'Local and remote match semantically.'
    : reasons.map((reason) => reason.message).join(' ');

  return {
    local,
    remote,
    status,
    reasons,
    summary,
  };
}

function summarizePairs(pairs) {
  return pairs.reduce((summary, pair) => {
    summary.total += 1;
    summary[pair.status] = (summary[pair.status] || 0) + 1;
    for (const reason of pair.reasons) {
      summary.reasonCounts[reason.code] = (summary.reasonCounts[reason.code] || 0) + 1;
    }
    return summary;
  }, {
    total: 0,
    same: 0,
    drifted: 0,
    reasonCounts: {},
  });
}

function diffAssets(localAssets, remoteAssets) {
  const localMap = new Map(localAssets.map((asset) => [`${asset.type}:${asset.name}`, asset]));
  const remoteMap = new Map(remoteAssets.map((asset) => [`${asset.type}:${asset.name}`, asset]));

  const onlyLocal = [];
  const onlyRemote = [];
  const both = [];

  for (const [key, asset] of localMap) {
    if (remoteMap.has(key)) {
      both.push(diffPair(asset, remoteMap.get(key)));
    } else {
      onlyLocal.push(asset);
    }
  }

  for (const [key, asset] of remoteMap) {
    if (!localMap.has(key)) {
      onlyRemote.push(asset);
    }
  }

  const pairSummary = summarizePairs(both);

  return {
    onlyLocal,
    onlyRemote,
    both,
    localCount: localAssets.length,
    remoteCount: remoteAssets.length,
    sameCount: pairSummary.same,
    driftedCount: pairSummary.drifted,
    reasonCounts: pairSummary.reasonCounts,
  };
}

module.exports = {
  diffAssets,
};
