'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const remote = require('./remote');
const store = require('./store');

function hashState(state) {
  return crypto.createHash('sha1').update(JSON.stringify({
    exists: state.exists,
    kind: state.kind,
    content: state.content,
    symlinkTarget: state.symlinkTarget,
  })).digest('hex');
}

function normalizeLocalState(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return {
      exists: false,
      kind: 'missing',
      content: null,
      symlinkTarget: null,
      hash: hashState({ exists: false, kind: 'missing', content: null, symlinkTarget: null }),
    };
  }

  const stat = fs.lstatSync(targetPath);
  if (stat.isSymbolicLink()) {
    const symlinkTarget = fs.readlinkSync(targetPath);
    return {
      exists: true,
      kind: 'symlink',
      content: null,
      symlinkTarget,
      hash: hashState({ exists: true, kind: 'symlink', content: null, symlinkTarget }),
    };
  }

  const content = fs.readFileSync(targetPath, 'utf-8');
  return {
    exists: true,
    kind: 'file',
    content,
    symlinkTarget: null,
    hash: hashState({ exists: true, kind: 'file', content, symlinkTarget: null }),
  };
}

async function normalizeRemoteState(client, targetPath) {
  const exists = await remote.sshExists(client, targetPath);
  if (!exists) {
    return {
      exists: false,
      kind: 'missing',
      content: null,
      symlinkTarget: null,
      hash: hashState({ exists: false, kind: 'missing', content: null, symlinkTarget: null }),
    };
  }

  const content = await remote.sshReadFile(client, targetPath);
  return {
    exists: true,
    kind: 'file',
    content,
    symlinkTarget: null,
    hash: hashState({ exists: true, kind: 'file', content, symlinkTarget: null }),
  };
}

function dedupeDescriptors(descriptors) {
  const seen = new Map();
  for (const descriptor of descriptors || []) {
    if (!descriptor?.targetPath) continue;
    const transport = descriptor.transport === 'remote' ? 'remote' : 'local';
    const environmentId = descriptor.environmentId || '';
    const key = `${transport}:${environmentId}:${descriptor.targetPath}`;
    if (!seen.has(key)) {
      seen.set(key, {
        transport,
        environmentId: descriptor.environmentId || null,
        targetPath: descriptor.targetPath,
      });
    }
  }
  return [...seen.values()];
}

async function captureDescriptors(descriptors, opts) {
  const unique = dedupeDescriptors(descriptors);
  const localEntries = unique.filter((entry) => entry.transport === 'local');
  const remoteEntries = unique.filter((entry) => entry.transport === 'remote');
  const entries = [];

  for (const descriptor of localEntries) {
    entries.push({
      ...descriptor,
      ...normalizeLocalState(descriptor.targetPath),
    });
  }

  const clients = new Map();
  try {
    for (const descriptor of remoteEntries) {
      const env = opts.getEnvironmentById(descriptor.environmentId);
      if (!env) {
        entries.push({
          ...descriptor,
          exists: false,
          kind: 'missing',
          content: null,
          symlinkTarget: null,
          hash: hashState({ exists: false, kind: 'missing', content: null, symlinkTarget: null }),
          captureError: 'Remote environment not found',
        });
        continue;
      }
      let client = clients.get(env.id);
      if (!client) {
        client = await remote.sshConnect(env);
        clients.set(env.id, client);
      }
      const state = await normalizeRemoteState(client, descriptor.targetPath);
      entries.push({ ...descriptor, ...state });
    }
  } finally {
    for (const environmentId of clients.keys()) {
      remote.sshDisconnect(environmentId);
    }
  }

  return entries;
}

async function beginSnapshot(input, opts) {
  const descriptors = dedupeDescriptors(input.entries || []);
  if (descriptors.length === 0) return null;

  const before = await captureDescriptors(descriptors, opts);
  return {
    id: input.id || null,
    action: input.action,
    label: input.label || input.action,
    metadata: input.metadata || null,
    descriptors,
    before,
  };
}

async function finalizeSnapshot(session, opts) {
  if (!session) return null;

  const after = await captureDescriptors(session.descriptors, opts);
  const entries = session.before.map((beforeEntry) => {
    const afterEntry = after.find((entry) =>
      entry.transport === beforeEntry.transport &&
      entry.environmentId === beforeEntry.environmentId &&
      entry.targetPath === beforeEntry.targetPath
    );
    return {
      transport: beforeEntry.transport,
      environmentId: beforeEntry.environmentId,
      targetPath: beforeEntry.targetPath,
      before: {
        exists: beforeEntry.exists,
        kind: beforeEntry.kind,
        content: beforeEntry.content,
        symlinkTarget: beforeEntry.symlinkTarget,
        hash: beforeEntry.hash,
      },
      after: {
        exists: afterEntry?.exists ?? false,
        kind: afterEntry?.kind ?? 'missing',
        content: afterEntry?.content ?? null,
        symlinkTarget: afterEntry?.symlinkTarget ?? null,
        hash: afterEntry?.hash ?? hashState({ exists: false, kind: 'missing', content: null, symlinkTarget: null }),
      },
    };
  }).filter((entry) => entry.before.hash !== entry.after.hash);

  if (entries.length === 0) return null;

  const snapshotId = store.saveSnapshot({
    action: session.action,
    label: session.label,
    metadata: session.metadata,
    entries,
  });

  return store.getSnapshot(snapshotId);
}

function ensureParentDir(targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}

function restoreLocalState(targetPath, state) {
  if (!state.exists || state.kind === 'missing') {
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { force: true });
    }
    return;
  }

  ensureParentDir(targetPath);
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { force: true });
  }

  if (state.kind === 'symlink') {
    fs.symlinkSync(state.symlinkTarget, targetPath);
    return;
  }

  fs.writeFileSync(targetPath, state.content || '', 'utf-8');
}

async function restoreRemoteState(client, targetPath, state) {
  if (!state.exists || state.kind === 'missing') {
    await remote.sshDeleteFile(client, targetPath);
    return;
  }

  await remote.sshWriteFile(client, targetPath, state.content || '');
}

async function rollbackSnapshot(snapshotId, opts) {
  const snapshot = store.getSnapshot(snapshotId);
  if (!snapshot) return { ok: false, error: 'Snapshot not found' };
  if (snapshot.rolled_back_at) return { ok: false, error: 'Snapshot already rolled back' };

  const current = await captureDescriptors(snapshot.entries.map((entry) => ({
    transport: entry.transport,
    environmentId: entry.environmentId,
    targetPath: entry.targetPath,
  })), opts);

  const conflicts = snapshot.entries.flatMap((entry) => {
    const currentEntry = current.find((candidate) =>
      candidate.transport === entry.transport &&
      candidate.environmentId === entry.environmentId &&
      candidate.targetPath === entry.targetPath
    );
    const currentHash = currentEntry?.hash || hashState({ exists: false, kind: 'missing', content: null, symlinkTarget: null });
    if (currentHash === entry.after.hash) return [];
    return [{
      targetPath: entry.targetPath,
      transport: entry.transport,
      environmentId: entry.environmentId,
      message: 'Current state no longer matches the post-change snapshot',
    }];
  });

  if (conflicts.length > 0) {
    return { ok: false, error: 'Rollback blocked by newer changes', conflicts };
  }

  const clients = new Map();
  try {
    for (const entry of [...snapshot.entries].reverse()) {
      if (entry.transport === 'remote') {
        const env = opts.getEnvironmentById(entry.environmentId);
        if (!env) {
          return { ok: false, error: `Remote environment not found for ${entry.targetPath}` };
        }
        let client = clients.get(env.id);
        if (!client) {
          client = await remote.sshConnect(env);
          clients.set(env.id, client);
        }
        await restoreRemoteState(client, entry.targetPath, entry.before);
      } else {
        restoreLocalState(entry.targetPath, entry.before);
      }
    }
  } finally {
    for (const environmentId of clients.keys()) {
      remote.sshDisconnect(environmentId);
    }
  }

  store.markSnapshotRolledBack(snapshotId);
  return { ok: true, snapshot, restored: snapshot.entries.length };
}

module.exports = {
  beginSnapshot,
  finalizeSnapshot,
  rollbackSnapshot,
};
