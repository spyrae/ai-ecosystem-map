'use strict';

let Database;
try {
  Database = require('better-sqlite3');
} catch (err) {
  console.error(`  Warning: better-sqlite3 failed to load (${err.message})`);
  console.error(`  Run "npm rebuild better-sqlite3" or install build tools (python3, make, g++).`);
  console.error(`  Falling back to in-memory mode (data will not persist).\n`);
  Database = null;
}

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { evaluateAssetHealth } = require('../health');

const HOME = process.env.HOME || process.env.USERPROFILE || '';

let db = null;
const SNAPSHOT_RETENTION_COUNT = 200;
const SNAPSHOT_RETENTION_SECONDS = 30 * 24 * 60 * 60;

function resolveDbPaths() {
  const testDbPath = process.env._AEM_TEST_DB || '';
  const dbDir = testDbPath ? path.dirname(testDbPath) : path.join(HOME, '.ai-ecosystem-map');
  const dbPath = testDbPath || path.join(dbDir, 'state.db');
  return { dbDir, dbPath };
}

/**
 * Initialize SQLite database. Creates tables on first run.
 * Falls back to a no-op store if better-sqlite3 is unavailable.
 */
function initStore() {
  if (db) return db;

  if (!Database) {
    _fallbackStore = createInMemoryFallback();
    db = _fallbackStore;
    return db;
  }

  const { dbDir, dbPath } = resolveDbPaths();

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  try {
    db = new Database(dbPath);
  } catch (err) {
    console.error(`  Warning: SQLite store unavailable (${err.message})`);
    console.error(`  Falling back to in-memory mode (data will not persist).\n`);
    _fallbackStore = createInMemoryFallback();
    db = _fallbackStore;
    return db;
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS environments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'local',
      ssh_host TEXT,
      ssh_port INTEGER DEFAULT 22,
      ssh_user TEXT,
      ssh_key_path TEXT,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      environment_id TEXT REFERENCES environments(id),
      last_scanned_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      file_path TEXT,
      environment_id TEXT REFERENCES environments(id),
      project_id TEXT REFERENCES projects(id),
      category TEXT,
      is_orchestrator INTEGER DEFAULT 0,
      tags TEXT,
      providers TEXT,
      keywords TEXT,
      deps TEXT,
      raw_config TEXT,
      hash TEXT,
      discovered_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(name, type, environment_id)
    );

    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      method TEXT NOT NULL,
      target_path TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      asset_id TEXT,
      asset_name TEXT,
      details TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      reverted INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      label TEXT,
      entries TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      rolled_back_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS running_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      description TEXT,
      protocol TEXT DEFAULT 'mcp',
      is_active INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);
    CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category);
    CREATE INDEX IF NOT EXISTS idx_assets_env ON assets(environment_id);
    CREATE INDEX IF NOT EXISTS idx_connections_asset ON connections(asset_id);
    CREATE INDEX IF NOT EXISTS idx_history_asset ON history(asset_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at DESC);
  `);

  // Ensure local environment exists
  const localEnv = db.prepare('SELECT id FROM environments WHERE type = ?').get('local');
  if (!localEnv) {
    const os = require('os');
    db.prepare('INSERT INTO environments (id, name, type) VALUES (?, ?, ?)').run(
      genId(), os.hostname(), 'local'
    );
  }

  return db;
}

function genId() {
  return crypto.randomBytes(12).toString('hex');
}

/**
 * In-memory fallback store when better-sqlite3 is unavailable.
 * Assets are kept in memory for the session, not persisted.
 */
function createInMemoryFallback() {
  const mem = {
    assets: [],
    environments: [{ id: 'local-fallback', name: require('os').hostname(), type: 'local' }],
    projects: [],
    history: [],
    snapshots: [],
    runningAgents: [],
  };
  return mem;
}

/** Check if running in fallback mode */
function isFallback() {
  return db && db === _fallbackStore;
}

let _fallbackStore = null;

function getDb() {
  if (!db) initStore();
  return db;
}

// ─── Assets ───────────────────────────────────────────

/**
 * Upsert assets from scan results. Only updates changed assets.
 */
function upsertAssets(categorizedData, environmentId) {
  if (isFallback()) {
    _fallbackStore.assets = categorizedData.map(item => ({
      id: genId(),
      name: item.name,
      type: item.type,
      description: item.desc || '',
      file_path: item.filePath || '',
      environment_id: environmentId || 'local-fallback',
      category: item.cat || 'Other',
      is_orchestrator: item.isOrchestrator ? 1 : 0,
      tags: JSON.stringify(item.tags || []),
      providers: JSON.stringify(item.providers || []),
      keywords: item.keywords || '',
      deps: JSON.stringify(item.deps || []),
    }));
    return;
  }

  const d = getDb();
  const upsert = d.prepare(`
    INSERT INTO assets (id, name, type, description, file_path, environment_id, category, is_orchestrator, tags, providers, keywords, deps, raw_config, hash, discovered_at, updated_at)
    VALUES (@id, @name, @type, @description, @file_path, @environment_id, @category, @is_orchestrator, @tags, @providers, @keywords, @deps, @raw_config, @hash, unixepoch(), unixepoch())
    ON CONFLICT(name, type, environment_id) DO UPDATE SET
      description = @description,
      file_path = @file_path,
      category = @category,
      is_orchestrator = @is_orchestrator,
      tags = @tags,
      providers = @providers,
      keywords = @keywords,
      deps = @deps,
      raw_config = @raw_config,
      hash = @hash,
      updated_at = unixepoch()
    WHERE hash != @hash
  `);

  const envId = environmentId || getLocalEnvironmentId();
  const currentNames = new Set();

  const transaction = d.transaction((items) => {
    for (const item of items) {
      const hash = crypto.createHash('md5').update(JSON.stringify(item)).digest('hex');
      currentNames.add(`${item.name}:${item.type}`);

      upsert.run({
        id: genId(),
        name: item.name,
        type: item.type,
        description: item.desc || '',
        file_path: item.filePath || '',
        environment_id: envId,
        category: item.cat || 'Other',
        is_orchestrator: item.isOrchestrator ? 1 : 0,
        tags: JSON.stringify(item.tags || []),
        providers: JSON.stringify(item.providers || []),
        keywords: item.keywords || '',
        deps: JSON.stringify(item.deps || []),
        raw_config: item.rawConfig ? JSON.stringify(item.rawConfig) : null,
        hash,
      });
    }

    // Remove assets no longer found in scan
    const existing = d.prepare('SELECT id, name, type FROM assets WHERE environment_id = ?').all(envId);
    for (const row of existing) {
      if (!currentNames.has(`${row.name}:${row.type}`)) {
        d.prepare('DELETE FROM assets WHERE id = ?').run(row.id);
      }
    }
  });

  transaction(categorizedData);
}

/**
 * Get all assets with optional filters
 */
function getAssets(filters = {}) {
  if (isFallback()) {
    let results = _fallbackStore.assets;
    if (filters.type) results = results.filter(a => a.type === filters.type);
    if (filters.category) results = results.filter(a => a.category === filters.category);
    if (filters.environment_id) results = results.filter(a => a.environment_id === filters.environment_id);
    if (filters.is_orchestrator) results = results.filter(a => a.is_orchestrator);
    if (filters.provider) results = results.filter(a => (a.providers || '').includes(`"${filters.provider}"`));
    if (filters.q) {
      const q = filters.q.toLowerCase();
      results = results.filter(a => a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q));
    }
    return results.map(deserializeAsset);
  }

  const d = getDb();
  let sql = 'SELECT * FROM assets WHERE 1=1';
  const params = {};

  if (filters.type) { sql += ' AND type = @type'; params.type = filters.type; }
  if (filters.category) { sql += ' AND category = @category'; params.category = filters.category; }
  if (filters.environment_id) { sql += ' AND environment_id = @environment_id'; params.environment_id = filters.environment_id; }
  if (filters.is_orchestrator) { sql += ' AND is_orchestrator = 1'; }
  if (filters.provider) {
    sql += " AND providers LIKE @provider_like";
    params.provider_like = `%"${filters.provider}"%`;
  }
  if (filters.q) {
    sql += ' AND (name LIKE @q_like OR description LIKE @q_like OR keywords LIKE @q_like)';
    params.q_like = `%${filters.q}%`;
  }

  sql += ' ORDER BY category, name';

  const rows = d.prepare(sql).all(params);
  return rows.map(deserializeAsset);
}

function getAssetByName(name, type) {
  if (isFallback()) {
    const row = _fallbackStore.assets.find(a => a.name === name && a.type === type);
    return row ? deserializeAsset(row) : null;
  }
  const d = getDb();
  const row = d.prepare('SELECT * FROM assets WHERE name = ? AND type = ?').get(name, type);
  return row ? deserializeAsset(row) : null;
}

function deserializeAsset(row) {
  const asset = {
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    providers: JSON.parse(row.providers || '[]'),
    deps: JSON.parse(row.deps || '[]'),
    isOrchestrator: !!row.is_orchestrator,
    desc: row.description,
    cat: row.category,
    filePath: row.file_path,
    rawConfig: row.raw_config ? JSON.parse(row.raw_config) : null,
  };
  return {
    ...asset,
    health: evaluateAssetHealth(asset, {
      isLocalEnvironment: !asset.environment_id || asset.environment_id === getLocalEnvironmentId(),
    }),
  };
}

// ─── Stats ────────────────────────────────────────────

function getStats() {
  if (isFallback()) {
    const a = _fallbackStore.assets;
    const stats = { total: a.length, orchestrator: a.filter(x => x.is_orchestrator).length };
    for (const item of a) stats[item.type] = (stats[item.type] || 0) + 1;
    return stats;
  }
  const d = getDb();
  const total = d.prepare('SELECT COUNT(*) as c FROM assets').get().c;
  const byType = d.prepare('SELECT type, COUNT(*) as c FROM assets GROUP BY type').all();
  const orchestrators = d.prepare('SELECT COUNT(*) as c FROM assets WHERE is_orchestrator = 1').get().c;

  const stats = { total, orchestrator: orchestrators };
  for (const row of byType) stats[row.type] = row.c;
  return stats;
}

function getCategories() {
  if (isFallback()) {
    const cats = {};
    for (const a of _fallbackStore.assets) cats[a.category] = (cats[a.category] || 0) + 1;
    return Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count }));
  }
  const d = getDb();
  return d.prepare('SELECT category, COUNT(*) as count FROM assets GROUP BY category ORDER BY count DESC').all();
}

function getProviderStats() {
  const items = isFallback() ? _fallbackStore.assets : getDb().prepare('SELECT providers, type FROM assets').all();
  const stats = {};
  for (const a of items) {
    const providers = JSON.parse(a.providers || '[]');
    for (const p of providers) {
      if (!stats[p]) stats[p] = { name: p, count: 0, types: {} };
      stats[p].count++;
      const type = a.type;
      stats[p].types[type] = (stats[p].types[type] || 0) + 1;
    }
  }
  return Object.values(stats);
}

// ─── Environments ─────────────────────────────────────

function getLocalEnvironmentId() {
  if (isFallback()) return 'local-fallback';
  const d = getDb();
  const row = d.prepare('SELECT id FROM environments WHERE type = ?').get('local');
  return row ? row.id : null;
}

function getEnvironments() {
  if (isFallback()) return _fallbackStore.environments;
  return getDb().prepare('SELECT * FROM environments ORDER BY type, name').all();
}

function addEnvironment(env) {
  if (isFallback()) {
    const id = genId();
    _fallbackStore.environments.push({ id, name: env.name, type: env.type || 'remote', ...env });
    return id;
  }
  const d = getDb();
  const id = genId();
  d.prepare('INSERT INTO environments (id, name, type, ssh_host, ssh_port, ssh_user, ssh_key_path) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, env.name, env.type || 'remote', env.ssh_host, env.ssh_port || 22, env.ssh_user, env.ssh_key_path
  );
  return id;
}

// ─── Projects ─────────────────────────────────────────

function enrichFallbackProject(project) {
  const env = _fallbackStore.environments.find((entry) => entry.id === project.environment_id);
  return {
    ...project,
    environment_name: env?.name || null,
    environment_type: env?.type || null,
  };
}

function getProjects(filters = {}) {
  if (isFallback()) {
    let projects = _fallbackStore.projects;
    if (filters.environment_id) {
      projects = projects.filter((project) => project.environment_id === filters.environment_id);
    }
    return projects.map(enrichFallbackProject);
  }

  let sql = `
    SELECT p.*, e.name AS environment_name, e.type AS environment_type
    FROM projects p
    LEFT JOIN environments e ON e.id = p.environment_id
    WHERE 1=1
  `;
  const params = {};
  if (filters.environment_id) {
    sql += ' AND p.environment_id = @environment_id';
    params.environment_id = filters.environment_id;
  }
  sql += ' ORDER BY CASE WHEN e.type = \'local\' THEN 0 ELSE 1 END, e.name, p.name';
  return getDb().prepare(sql).all(params);
}

function getProjectById(projectId) {
  if (!projectId) return null;

  if (isFallback()) {
    const project = _fallbackStore.projects.find((entry) => entry.id === projectId);
    return project ? enrichFallbackProject(project) : null;
  }

  return getDb().prepare(`
    SELECT p.*, e.name AS environment_name, e.type AS environment_type
    FROM projects p
    LEFT JOIN environments e ON e.id = p.environment_id
    WHERE p.id = ?
  `).get(projectId) || null;
}

function addProject(name, projectPath, environmentId) {
  const envId = environmentId || getLocalEnvironmentId();

  if (isFallback()) {
    const existing = _fallbackStore.projects.find((entry) => entry.path === projectPath && entry.environment_id === envId);
    if (existing) return existing.id;

    const id = genId();
    _fallbackStore.projects.push({ id, name, path: projectPath, environment_id: envId });
    return id;
  }

  const d = getDb();
  const existing = d.prepare('SELECT id FROM projects WHERE path = ? AND environment_id = ?').get(projectPath, envId);
  if (existing?.id) return existing.id;

  const byPath = d.prepare('SELECT id, environment_id FROM projects WHERE path = ?').get(projectPath);
  if (byPath?.id) {
    if (byPath.environment_id === envId) return byPath.id;
    d.prepare('UPDATE projects SET name = ?, environment_id = ? WHERE id = ?').run(name, envId, byPath.id);
    return byPath.id;
  }

  const id = genId();
  d.prepare('INSERT INTO projects (id, name, path, environment_id) VALUES (?, ?, ?, ?)').run(id, name, projectPath, envId);
  return id;
}

// ─── History ──────────────────────────────────────────

function recordAction(action, assetName, details) {
  if (isFallback()) {
    const id = _fallbackStore.history.length + 1;
    _fallbackStore.history.push({
      id,
      action,
      asset_name: assetName,
      details: JSON.stringify(details || {}),
      created_at: Date.now(),
      reverted: 0,
    });
    return id;
  }
  const d = getDb();
  const info = d.prepare('INSERT INTO history (action, asset_name, details) VALUES (?, ?, ?)').run(
    action, assetName, JSON.stringify(details || {})
  );
  return Number(info.lastInsertRowid);
}

function parseHistoryDetails(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function pruneSnapshots() {
  if (isFallback()) {
    const cutoff = Date.now() - SNAPSHOT_RETENTION_SECONDS * 1000;
    _fallbackStore.snapshots = _fallbackStore.snapshots
      .filter((snapshot) => snapshot.created_at >= cutoff)
      .slice(-SNAPSHOT_RETENTION_COUNT);
    return;
  }

  const d = getDb();
  d.prepare('DELETE FROM snapshots WHERE created_at < unixepoch() - ?').run(SNAPSHOT_RETENTION_SECONDS);
  const overflow = d.prepare('SELECT id FROM snapshots ORDER BY created_at DESC LIMIT -1 OFFSET ?').all(SNAPSHOT_RETENTION_COUNT);
  for (const row of overflow) {
    d.prepare('DELETE FROM snapshots WHERE id = ?').run(row.id);
  }
}

function saveSnapshot(snapshot) {
  const payload = {
    id: snapshot.id || genId(),
    action: snapshot.action,
    label: snapshot.label || snapshot.action,
    entries: JSON.stringify(snapshot.entries || []),
    metadata: snapshot.metadata ? JSON.stringify(snapshot.metadata) : null,
  };

  if (isFallback()) {
    _fallbackStore.snapshots.push({
      ...payload,
      created_at: Date.now(),
      rolled_back_at: null,
    });
    pruneSnapshots();
    return payload.id;
  }

  getDb().prepare('INSERT INTO snapshots (id, action, label, entries, metadata) VALUES (?, ?, ?, ?, ?)').run(
    payload.id,
    payload.action,
    payload.label,
    payload.entries,
    payload.metadata
  );
  pruneSnapshots();
  return payload.id;
}

function getSnapshot(snapshotId) {
  if (!snapshotId) return null;

  const row = isFallback()
    ? _fallbackStore.snapshots.find((snapshot) => snapshot.id === snapshotId)
    : getDb().prepare('SELECT * FROM snapshots WHERE id = ?').get(snapshotId);

  if (!row) return null;
  return {
    ...row,
    entries: JSON.parse(row.entries || '[]'),
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  };
}

function markSnapshotRolledBack(snapshotId) {
  if (!snapshotId) return;

  if (isFallback()) {
    const row = _fallbackStore.snapshots.find((snapshot) => snapshot.id === snapshotId);
    if (row) row.rolled_back_at = Date.now();
    return;
  }

  getDb().prepare('UPDATE snapshots SET rolled_back_at = unixepoch() WHERE id = ?').run(snapshotId);
}

function getHistoryEntry(id) {
  if (!id) return null;
  const row = isFallback()
    ? _fallbackStore.history.find((entry) => entry.id === id)
    : getDb().prepare('SELECT * FROM history WHERE id = ?').get(id);

  if (!row) return null;

  const detailsJson = parseHistoryDetails(row.details);
  const snapshot = detailsJson.snapshotId ? getSnapshot(detailsJson.snapshotId) : null;
  return {
    ...row,
    details_json: detailsJson,
    snapshot_id: detailsJson.snapshotId || null,
    can_rollback: Boolean(detailsJson.snapshotId && row.reverted === 0 && !snapshot?.rolled_back_at),
    rolled_back_at: snapshot?.rolled_back_at || null,
  };
}

function markHistoryReverted(id) {
  if (!id) return;
  if (isFallback()) {
    const row = _fallbackStore.history.find((entry) => entry.id === id);
    if (row) row.reverted = 1;
    return;
  }
  getDb().prepare('UPDATE history SET reverted = 1 WHERE id = ?').run(id);
}

function getHistory(limit = 50) {
  const rows = isFallback()
    ? _fallbackStore.history.slice(-limit).reverse()
    : getDb().prepare('SELECT * FROM history ORDER BY created_at DESC LIMIT ?').all(limit);

  return rows.map((row) => {
    const detailsJson = parseHistoryDetails(row.details);
    const snapshot = detailsJson.snapshotId ? getSnapshot(detailsJson.snapshotId) : null;
    return {
      ...row,
      details_json: detailsJson,
      snapshot_id: detailsJson.snapshotId || null,
      can_rollback: Boolean(detailsJson.snapshotId && row.reverted === 0 && !snapshot?.rolled_back_at),
      rolled_back_at: snapshot?.rolled_back_at || null,
    };
  });
}

function undoLast() {
  const last = getHistory(100).find((entry) => entry.can_rollback);
  if (!last) return { ok: false, error: 'Nothing to undo' };
  return { ok: true, history: last };
}

// ─── Running Agents ──────────────────────────────────

function getRunningAgents() {
  if (isFallback()) return _fallbackStore.runningAgents;
  return getDb().prepare('SELECT * FROM running_agents WHERE is_active = 1 ORDER BY name').all();
}

function addRunningAgent(agent) {
  if (isFallback()) {
    const id = genId();
    _fallbackStore.runningAgents.push({ id, ...agent, is_active: 1 });
    return id;
  }
  const d = getDb();
  const id = genId();
  d.prepare('INSERT INTO running_agents (id, name, url, description, protocol) VALUES (?, ?, ?, ?, ?)').run(
    id, agent.name, agent.url, agent.description || '', agent.protocol || 'mcp'
  );
  return id;
}

function removeRunningAgent(id) {
  if (isFallback()) {
    _fallbackStore.runningAgents = _fallbackStore.runningAgents.filter(a => a.id !== id);
    return;
  }
  getDb().prepare('DELETE FROM running_agents WHERE id = ?').run(id);
}

// ─── Cleanup ──────────────────────────────────────────

function close() {
  if (db && !isFallback()) { db.close(); }
  db = null;
  _fallbackStore = null;
}

module.exports = {
  initStore,
  getDb,
  upsertAssets,
  getAssets,
  getAssetByName,
  getStats,
  getCategories,
  getProviderStats,
  getLocalEnvironmentId,
  getEnvironments,
  addEnvironment,
  getProjects,
  getProjectById,
  addProject,
  recordAction,
  saveSnapshot,
  getSnapshot,
  markSnapshotRolledBack,
  getHistory,
  getHistoryEntry,
  markHistoryReverted,
  undoLast,
  getRunningAgents,
  addRunningAgent,
  removeRunningAgent,
  close,
  get DB_PATH() {
    return resolveDbPaths().dbPath;
  },
};
