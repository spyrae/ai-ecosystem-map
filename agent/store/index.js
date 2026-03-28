'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const DB_DIR = path.join(HOME, '.ai-ecosystem-map');
const DB_PATH = path.join(DB_DIR, 'state.db');

let db = null;

/**
 * Initialize SQLite database. Creates tables on first run.
 */
function initStore() {
  if (db) return db;

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

function getDb() {
  if (!db) initStore();
  return db;
}

// ─── Assets ───────────────────────────────────────────

/**
 * Upsert assets from scan results. Only updates changed assets.
 */
function upsertAssets(categorizedData, environmentId) {
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
  const d = getDb();
  const total = d.prepare('SELECT COUNT(*) as c FROM assets').get().c;
  const byType = d.prepare('SELECT type, COUNT(*) as c FROM assets GROUP BY type').all();
  const orchestrators = d.prepare('SELECT COUNT(*) as c FROM assets WHERE is_orchestrator = 1').get().c;

  const stats = { total, orchestrator: orchestrators };
  for (const row of byType) stats[row.type] = row.c;
  return stats;
}

function getCategories() {
  const d = getDb();
  return d.prepare('SELECT category, COUNT(*) as count FROM assets GROUP BY category ORDER BY count DESC').all();
}

function getProviderStats() {
  const d = getDb();
  const assets = d.prepare('SELECT providers, type FROM assets').all();
  const stats = {};
  for (const a of assets) {
    const providers = JSON.parse(a.providers || '[]');
    for (const p of providers) {
      if (!stats[p]) stats[p] = { name: p, count: 0, types: {} };
      stats[p].count++;
      stats[p].types[a.type] = (stats[p].types[a.type] || 0) + 1;
    }
  }
  return Object.values(stats);
}

// ─── Environments ─────────────────────────────────────

function getLocalEnvironmentId() {
  const d = getDb();
  const row = d.prepare('SELECT id FROM environments WHERE type = ?').get('local');
  return row ? row.id : null;
}

function getEnvironments() {
  return getDb().prepare('SELECT * FROM environments ORDER BY type, name').all();
}

function addEnvironment(env) {
  const d = getDb();
  const id = genId();
  d.prepare('INSERT INTO environments (id, name, type, ssh_host, ssh_port, ssh_user, ssh_key_path) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, env.name, env.type || 'remote', env.ssh_host, env.ssh_port || 22, env.ssh_user, env.ssh_key_path
  );
  return id;
}

// ─── Projects ─────────────────────────────────────────

function getProjects() {
  return getDb().prepare('SELECT * FROM projects ORDER BY name').all();
}

function addProject(name, projectPath) {
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
  const d = getDb();
  d.prepare('INSERT INTO history (action, asset_name, details) VALUES (?, ?, ?)').run(
    action, assetName, JSON.stringify(details)
  );
}

function getHistory(limit = 50) {
  return getDb().prepare('SELECT * FROM history ORDER BY created_at DESC LIMIT ?').all(limit);
}

function undoLast() {
  const d = getDb();
  const last = d.prepare('SELECT * FROM history WHERE reverted = 0 ORDER BY created_at DESC LIMIT 1').get();
  if (!last) return { ok: false, error: 'Nothing to undo' };

  d.prepare('UPDATE history SET reverted = 1 WHERE id = ?').run(last.id);
  return { ok: true, action: last.action, asset: last.asset_name, details: JSON.parse(last.details || '{}') };
}

// ─── Cleanup ──────────────────────────────────────────

function close() {
  if (db) { db.close(); db = null; }
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
  close,
  DB_PATH,
};
