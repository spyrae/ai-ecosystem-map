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

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const DB_DIR = path.join(HOME, '.ai-ecosystem-map');
const DB_PATH = path.join(DB_DIR, 'state.db');

let db = null;

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

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
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
    INSERT INTO assets (id, name, type, description, file_path, environment_id, category, is_orchestrator, tags, providers, keywords, deps, hash, discovered_at, updated_at)
    VALUES (@id, @name, @type, @description, @file_path, @environment_id, @category, @is_orchestrator, @tags, @providers, @keywords, @deps, @hash, unixepoch(), unixepoch())
    ON CONFLICT(name, type, environment_id) DO UPDATE SET
      description = @description,
      file_path = @file_path,
      category = @category,
      is_orchestrator = @is_orchestrator,
      tags = @tags,
      providers = @providers,
      keywords = @keywords,
      deps = @deps,
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
  return {
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    providers: JSON.parse(row.providers || '[]'),
    deps: JSON.parse(row.deps || '[]'),
    isOrchestrator: !!row.is_orchestrator,
    desc: row.description,
    cat: row.category,
    filePath: row.file_path,
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

function getProjects() {
  if (isFallback()) return _fallbackStore.projects;
  return getDb().prepare('SELECT * FROM projects ORDER BY name').all();
}

function addProject(name, projectPath) {
  if (isFallback()) {
    const id = genId();
    _fallbackStore.projects.push({ id, name, path: projectPath, environment_id: 'local-fallback' });
    return id;
  }
  const d = getDb();
  const id = genId();
  const envId = getLocalEnvironmentId();
  d.prepare('INSERT OR IGNORE INTO projects (id, name, path, environment_id) VALUES (?, ?, ?, ?)').run(
    id, name, projectPath, envId
  );
  return id;
}

// ─── History ──────────────────────────────────────────

function recordAction(action, assetName, details) {
  if (isFallback()) {
    _fallbackStore.history.push({ action, asset_name: assetName, details: JSON.stringify(details), created_at: Date.now() });
    return;
  }
  const d = getDb();
  d.prepare('INSERT INTO history (action, asset_name, details) VALUES (?, ?, ?)').run(
    action, assetName, JSON.stringify(details)
  );
}

function getHistory(limit = 50) {
  if (isFallback()) return _fallbackStore.history.slice(-limit).reverse();
  return getDb().prepare('SELECT * FROM history ORDER BY created_at DESC LIMIT ?').all(limit);
}

function undoLast() {
  if (isFallback()) return { ok: false, error: 'Undo not available in fallback mode' };
  const d = getDb();
  const last = d.prepare('SELECT * FROM history WHERE reverted = 0 ORDER BY created_at DESC LIMIT 1').get();
  if (!last) return { ok: false, error: 'Nothing to undo' };

  d.prepare('UPDATE history SET reverted = 1 WHERE id = ?').run(last.id);
  return { ok: true, action: last.action, asset: last.asset_name, details: JSON.parse(last.details || '{}') };
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
  addProject,
  recordAction,
  getHistory,
  undoLast,
  getRunningAgents,
  addRunningAgent,
  removeRunningAgent,
  close,
  DB_PATH,
};
