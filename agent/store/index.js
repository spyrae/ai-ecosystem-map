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
  const testDbPath = process.env._HCP_TEST_DB || process.env._AEM_TEST_DB || '';
  const dbDir = testDbPath ? path.dirname(testDbPath) : path.join(HOME, '.harness-control-plane');
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
      read_only INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      environment_id TEXT REFERENCES environments(id),
      project_type TEXT,
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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS asset_source_truth (
      group_key TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS bundles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      current_version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS bundle_versions (
      id TEXT PRIMARY KEY,
      bundle_id TEXT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      label TEXT,
      description TEXT,
      items_json TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(bundle_id, version)
    );

    CREATE TABLE IF NOT EXISTS bundle_applications (
      id TEXT PRIMARY KEY,
      bundle_id TEXT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
      target_kind TEXT NOT NULL,
      target_ref TEXT NOT NULL,
      target_label TEXT NOT NULL,
      target_meta TEXT,
      bundle_version INTEGER NOT NULL,
      applied_at INTEGER DEFAULT (unixepoch()),
      last_status TEXT,
      last_summary TEXT,
      UNIQUE(bundle_id, target_kind, target_ref)
    );

    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      enabled INTEGER DEFAULT 1,
      severity TEXT NOT NULL DEFAULT 'warning',
      selectors_json TEXT NOT NULL,
      rules_json TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);
    CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category);
    CREATE INDEX IF NOT EXISTS idx_assets_env ON assets(environment_id);
    CREATE INDEX IF NOT EXISTS idx_connections_asset ON connections(asset_id);
    CREATE INDEX IF NOT EXISTS idx_history_asset ON history(asset_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_source_truth_asset_id ON asset_source_truth(asset_id);
    CREATE INDEX IF NOT EXISTS idx_bundle_versions_bundle_id ON bundle_versions(bundle_id, version DESC);
    CREATE INDEX IF NOT EXISTS idx_bundle_applications_bundle_id ON bundle_applications(bundle_id, applied_at DESC);
    CREATE INDEX IF NOT EXISTS idx_policies_enabled ON policies(enabled, name);
  `);

  const environmentColumns = db.prepare(`PRAGMA table_info(environments)`).all().map((row) => row.name);
  if (!environmentColumns.includes('read_only')) {
    db.exec('ALTER TABLE environments ADD COLUMN read_only INTEGER DEFAULT 0');
  }
  const projectColumns = db.prepare(`PRAGMA table_info(projects)`).all().map((row) => row.name);
  if (!projectColumns.includes('project_type')) {
    db.exec('ALTER TABLE projects ADD COLUMN project_type TEXT');
  }

  // Ensure local environment exists
  const localEnv = db.prepare('SELECT id FROM environments WHERE type = ?').get('local');
  if (!localEnv) {
    const os = require('os');
    db.prepare('INSERT INTO environments (id, name, type) VALUES (?, ?, ?)').run(
      genId(), os.hostname(), 'local'
    );
  }

  const auditModeSetting = db.prepare('SELECT key FROM settings WHERE key = ?').get('global_read_only');
  if (!auditModeSetting) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('global_read_only', '0');
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
    environments: [{ id: 'local-fallback', name: require('os').hostname(), type: 'local', read_only: 0 }],
    projects: [],
    history: [],
    snapshots: [],
    runningAgents: [],
    bundles: [],
    bundleVersions: [],
    bundleApplications: [],
    policies: [],
    sourceTruth: {},
    settings: {
      global_read_only: '0',
    },
  };
  return mem;
}

/** Check if running in fallback mode */
function isFallback() {
  if (!db) initStore();
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
    _fallbackStore.environments.push({ id, name: env.name, type: env.type || 'remote', read_only: 0, ...env });
    return id;
  }
  const d = getDb();
  const id = genId();
  d.prepare('INSERT INTO environments (id, name, type, ssh_host, ssh_port, ssh_user, ssh_key_path, read_only) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, env.name, env.type || 'remote', env.ssh_host, env.ssh_port || 22, env.ssh_user, env.ssh_key_path, env.read_only ? 1 : 0
  );
  return id;
}

function setEnvironmentReadOnly(environmentId, readOnly) {
  if (!environmentId) return false;

  if (isFallback()) {
    const environment = _fallbackStore.environments.find((entry) => entry.id === environmentId);
    if (!environment) return false;
    environment.read_only = readOnly ? 1 : 0;
    return true;
  }

  const info = getDb().prepare('UPDATE environments SET read_only = ?, updated_at = unixepoch() WHERE id = ?').run(
    readOnly ? 1 : 0,
    environmentId
  );
  return info.changes > 0;
}

function getSetting(key) {
  if (!key) return null;

  if (isFallback()) {
    return _fallbackStore.settings[key] ?? null;
  }

  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value ?? null;
}

function setSetting(key, value) {
  if (!key) return false;

  if (isFallback()) {
    _fallbackStore.settings[key] = value;
    return true;
  }

  getDb().prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = unixepoch()
  `).run(key, value);
  return true;
}

function getAuditMode() {
  const environments = getEnvironments();
  return {
    global_read_only: getSetting('global_read_only') === '1',
    environments: environments.map((environment) => ({
      environment_id: environment.id,
      name: environment.name,
      type: environment.type,
      read_only: Number(environment.read_only || 0) === 1,
      ssh_host: environment.ssh_host || null,
    })),
  };
}

function setGlobalReadOnly(readOnly) {
  return setSetting('global_read_only', readOnly ? '1' : '0');
}

// ─── Projects ─────────────────────────────────────────

function enrichFallbackProject(project) {
  const env = _fallbackStore.environments.find((entry) => entry.id === project.environment_id);
  return {
    ...project,
    environment_name: env?.name || null,
    environment_type: env?.type || null,
    project_type: project.project_type || null,
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
    _fallbackStore.projects.push({ id, name, path: projectPath, environment_id: envId, project_type: null });
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

function setProjectType(projectId, projectType) {
  const normalized = typeof projectType === 'string' && projectType.trim() ? projectType.trim() : null;
  if (!projectId) return null;

  if (isFallback()) {
    const project = _fallbackStore.projects.find((entry) => entry.id === projectId);
    if (!project) return null;
    project.project_type = normalized;
    return enrichFallbackProject(project);
  }

  const info = getDb().prepare('UPDATE projects SET project_type = ? WHERE id = ?').run(normalized, projectId);
  if (!info.changes) return null;
  return getProjectById(projectId);
}

function getSourceOfTruthMap() {
  if (isFallback()) {
    return { ..._fallbackStore.sourceTruth };
  }

  const rows = getDb().prepare('SELECT group_key, asset_id FROM asset_source_truth').all();
  return Object.fromEntries(rows.map((row) => [row.group_key, row.asset_id]));
}

function getSourceOfTruth(groupKey) {
  if (!groupKey) return null;

  if (isFallback()) {
    return _fallbackStore.sourceTruth[groupKey] || null;
  }

  const row = getDb().prepare('SELECT asset_id FROM asset_source_truth WHERE group_key = ?').get(groupKey);
  return row?.asset_id || null;
}

function setSourceOfTruth(groupKey, assetId) {
  if (!groupKey || !assetId) return false;

  if (isFallback()) {
    _fallbackStore.sourceTruth[groupKey] = assetId;
    return true;
  }

  getDb().prepare(`
    INSERT INTO asset_source_truth (group_key, asset_id, updated_at)
    VALUES (?, ?, unixepoch())
    ON CONFLICT(group_key) DO UPDATE SET
      asset_id = excluded.asset_id,
      updated_at = unixepoch()
  `).run(groupKey, assetId);
  return true;
}

function clearSourceOfTruth(groupKey) {
  if (!groupKey) return;

  if (isFallback()) {
    delete _fallbackStore.sourceTruth[groupKey];
    return;
  }

  getDb().prepare('DELETE FROM asset_source_truth WHERE group_key = ?').run(groupKey);
}

// ─── Bundles ──────────────────────────────────────────

function normalizeBundleItem(item) {
  if (!item || !item.name || !item.type) return null;
  return {
    assetId: item.assetId || null,
    name: String(item.name),
    type: String(item.type),
    filePath: item.filePath || null,
    providers: Array.isArray(item.providers) ? [...new Set(item.providers.filter(Boolean))] : [],
    projectPath: item.projectPath || null,
    scope: item.scope || null,
  };
}

function normalizeBundleItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(normalizeBundleItem)
    .filter(Boolean)
    .sort((left, right) => {
      const leftKey = `${left.type}:${left.name}`;
      const rightKey = `${right.type}:${right.name}`;
      return leftKey.localeCompare(rightKey);
    });
}

function parseBundleItems(raw) {
  try {
    return normalizeBundleItems(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

function parseBundleMeta(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function getBundleVersionRows(bundleId) {
  if (isFallback()) {
    return _fallbackStore.bundleVersions
      .filter((row) => row.bundle_id === bundleId)
      .sort((left, right) => right.version - left.version);
  }

  return getDb()
    .prepare('SELECT * FROM bundle_versions WHERE bundle_id = ? ORDER BY version DESC')
    .all(bundleId);
}

function getBundleApplicationRows(bundleId) {
  if (isFallback()) {
    return _fallbackStore.bundleApplications
      .filter((row) => row.bundle_id === bundleId)
      .sort((left, right) => (right.applied_at || 0) - (left.applied_at || 0));
  }

  return getDb()
    .prepare('SELECT * FROM bundle_applications WHERE bundle_id = ? ORDER BY applied_at DESC')
    .all(bundleId);
}

function getBundleCurrentVersionRow(bundleId, currentVersion) {
  const versions = getBundleVersionRows(bundleId);
  return versions.find((row) => row.version === currentVersion) || versions[0] || null;
}

function getBundleApplications(bundleId) {
  return getBundleApplicationRows(bundleId).map((row) => ({
    id: row.id,
    target_kind: row.target_kind,
    target_ref: row.target_ref,
    target_label: row.target_label,
    target_meta: parseBundleMeta(row.target_meta),
    bundle_version: row.bundle_version,
    applied_at: row.applied_at,
    last_status: row.last_status || 'unknown',
    last_summary: row.last_summary || '',
    outdated: false,
  }));
}

function enrichBundle(bundle) {
  if (!bundle) return null;
  const currentVersionRow = getBundleCurrentVersionRow(bundle.id, bundle.current_version);
  const versions = getBundleVersionRows(bundle.id).map((row) => ({
    id: row.id,
    version: row.version,
    label: row.label || '',
    description: row.description || '',
    items: parseBundleItems(row.items_json),
    itemCount: parseBundleItems(row.items_json).length,
    created_at: row.created_at,
  }));
  const applications = getBundleApplications(bundle.id).map((application) => ({
    ...application,
    outdated: application.bundle_version < bundle.current_version,
  }));

  return {
    ...bundle,
    description: bundle.description || '',
    current_version: bundle.current_version,
    items: currentVersionRow ? parseBundleItems(currentVersionRow.items_json) : [],
    itemCount: currentVersionRow ? parseBundleItems(currentVersionRow.items_json).length : 0,
    versions,
    applications,
    applicationCount: applications.length,
    outdatedApplicationCount: applications.filter((application) => application.outdated).length,
    lastAppliedAt: applications[0]?.applied_at || null,
  };
}

function getBundles() {
  if (isFallback()) {
    return _fallbackStore.bundles
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(enrichBundle);
  }

  return getDb()
    .prepare('SELECT * FROM bundles ORDER BY name')
    .all()
    .map(enrichBundle);
}

function getBundleById(bundleId) {
  if (!bundleId) return null;

  if (isFallback()) {
    const row = _fallbackStore.bundles.find((entry) => entry.id === bundleId);
    return row ? enrichBundle(row) : null;
  }

  const row = getDb().prepare('SELECT * FROM bundles WHERE id = ?').get(bundleId);
  return row ? enrichBundle(row) : null;
}

function parseJsonValue(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizePolicyRow(row) {
  if (!row) return null;
  return {
    ...row,
    description: row.description || '',
    enabled: Number(row.enabled || 0) === 1,
    selectors: parseJsonValue(row.selectors_json, {}),
    rules: parseJsonValue(row.rules_json, []),
  };
}

function getPolicies() {
  if (isFallback()) {
    return _fallbackStore.policies
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(normalizePolicyRow);
  }

  return getDb()
    .prepare('SELECT * FROM policies ORDER BY enabled DESC, name')
    .all()
    .map(normalizePolicyRow);
}

function getPolicyById(policyId) {
  if (!policyId) return null;

  if (isFallback()) {
    const row = _fallbackStore.policies.find((entry) => entry.id === policyId);
    return row ? normalizePolicyRow(row) : null;
  }

  const row = getDb().prepare('SELECT * FROM policies WHERE id = ?').get(policyId);
  return row ? normalizePolicyRow(row) : null;
}

function createPolicy({ name, description = '', enabled = true, severity = 'warning', selectors = {}, rules = [] }) {
  if (!name) throw new Error('Policy name is required');

  const payload = {
    id: genId(),
    name: String(name).trim(),
    description: String(description || '').trim(),
    enabled: enabled ? 1 : 0,
    severity,
    selectors_json: JSON.stringify(selectors || {}),
    rules_json: JSON.stringify(rules || []),
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  if (isFallback()) {
    if (_fallbackStore.policies.some((entry) => entry.name.toLowerCase() === payload.name.toLowerCase())) {
      throw new Error('Policy name already exists');
    }
    _fallbackStore.policies.push(payload);
    return getPolicyById(payload.id);
  }

  const d = getDb();
  const existing = d.prepare('SELECT id FROM policies WHERE lower(name) = lower(?)').get(payload.name);
  if (existing?.id) throw new Error('Policy name already exists');

  d.prepare(`
    INSERT INTO policies (id, name, description, enabled, severity, selectors_json, rules_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
  `).run(
    payload.id,
    payload.name,
    payload.description,
    payload.enabled,
    payload.severity,
    payload.selectors_json,
    payload.rules_json
  );

  return getPolicyById(payload.id);
}

function updatePolicy(policyId, { name, description, enabled, severity, selectors, rules }) {
  const current = getPolicyById(policyId);
  if (!current) throw new Error('Policy not found');

  const nextName = typeof name === 'string' ? name.trim() : current.name;
  const nextDescription = typeof description === 'string' ? description.trim() : current.description;
  const nextEnabled = typeof enabled === 'boolean' ? enabled : current.enabled;
  const nextSeverity = typeof severity === 'string' ? severity : current.severity;
  const nextSelectors = selectors !== undefined ? selectors : current.selectors;
  const nextRules = rules !== undefined ? rules : current.rules;

  if (isFallback()) {
    const duplicate = _fallbackStore.policies.find((entry) => entry.id !== policyId && entry.name.toLowerCase() === nextName.toLowerCase());
    if (duplicate) throw new Error('Policy name already exists');
    const row = _fallbackStore.policies.find((entry) => entry.id === policyId);
    if (!row) throw new Error('Policy not found');
    row.name = nextName;
    row.description = nextDescription;
    row.enabled = nextEnabled ? 1 : 0;
    row.severity = nextSeverity;
    row.selectors_json = JSON.stringify(nextSelectors || {});
    row.rules_json = JSON.stringify(nextRules || []);
    row.updated_at = Date.now();
    return getPolicyById(policyId);
  }

  const d = getDb();
  const duplicate = d.prepare('SELECT id FROM policies WHERE id != ? AND lower(name) = lower(?)').get(policyId, nextName);
  if (duplicate?.id) throw new Error('Policy name already exists');

  d.prepare(`
    UPDATE policies
    SET name = ?, description = ?, enabled = ?, severity = ?, selectors_json = ?, rules_json = ?, updated_at = unixepoch()
    WHERE id = ?
  `).run(
    nextName,
    nextDescription,
    nextEnabled ? 1 : 0,
    nextSeverity,
    JSON.stringify(nextSelectors || {}),
    JSON.stringify(nextRules || []),
    policyId
  );

  return getPolicyById(policyId);
}

function deletePolicy(policyId) {
  if (!policyId) return false;

  if (isFallback()) {
    const previousLength = _fallbackStore.policies.length;
    _fallbackStore.policies = _fallbackStore.policies.filter((entry) => entry.id !== policyId);
    return previousLength !== _fallbackStore.policies.length;
  }

  const info = getDb().prepare('DELETE FROM policies WHERE id = ?').run(policyId);
  return info.changes > 0;
}

function insertBundleVersion({ bundleId, version, label, description, items }) {
  const payload = {
    id: genId(),
    bundle_id: bundleId,
    version,
    label: label || '',
    description: description || '',
    items_json: JSON.stringify(normalizeBundleItems(items)),
    created_at: Date.now(),
  };

  if (isFallback()) {
    _fallbackStore.bundleVersions.push(payload);
    return payload.id;
  }

  getDb().prepare(`
    INSERT INTO bundle_versions (id, bundle_id, version, label, description, items_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(payload.id, payload.bundle_id, payload.version, payload.label, payload.description, payload.items_json);
  return payload.id;
}

function createBundle({ name, description = '', items = [], versionLabel = '' }) {
  if (!name) throw new Error('Bundle name is required');

  const normalizedItems = normalizeBundleItems(items);
  const payload = {
    id: genId(),
    name: String(name).trim(),
    description: String(description || '').trim(),
    current_version: 1,
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  if (isFallback()) {
    if (_fallbackStore.bundles.some((entry) => entry.name.toLowerCase() === payload.name.toLowerCase())) {
      throw new Error('Bundle name already exists');
    }
    _fallbackStore.bundles.push(payload);
    insertBundleVersion({
      bundleId: payload.id,
      version: 1,
      label: versionLabel,
      description: payload.description,
      items: normalizedItems,
    });
    return getBundleById(payload.id);
  }

  const d = getDb();
  const existing = d.prepare('SELECT id FROM bundles WHERE lower(name) = lower(?)').get(payload.name);
  if (existing?.id) {
    throw new Error('Bundle name already exists');
  }

  d.prepare(`
    INSERT INTO bundles (id, name, description, current_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
  `).run(payload.id, payload.name, payload.description, payload.current_version);

  insertBundleVersion({
    bundleId: payload.id,
    version: 1,
    label: versionLabel,
    description: payload.description,
    items: normalizedItems,
  });

  return getBundleById(payload.id);
}

function updateBundle(bundleId, { name, description, items, versionLabel = '' }) {
  const current = getBundleById(bundleId);
  if (!current) throw new Error('Bundle not found');

  const nextName = typeof name === 'string' ? name.trim() : current.name;
  const nextDescription = typeof description === 'string' ? description.trim() : current.description;
  const hasItemsUpdate = Array.isArray(items);
  const nextItems = hasItemsUpdate ? normalizeBundleItems(items) : current.items;
  const itemsChanged = JSON.stringify(nextItems) !== JSON.stringify(current.items);
  const descriptionChanged = nextDescription !== current.description;
  const nameChanged = nextName !== current.name;

  if (isFallback()) {
    const duplicate = _fallbackStore.bundles.find((entry) => entry.id !== bundleId && entry.name.toLowerCase() === nextName.toLowerCase());
    if (duplicate) throw new Error('Bundle name already exists');

    const row = _fallbackStore.bundles.find((entry) => entry.id === bundleId);
    if (!row) throw new Error('Bundle not found');
    row.name = nextName;
    row.description = nextDescription;
    row.updated_at = Date.now();
    if (itemsChanged || descriptionChanged) {
      row.current_version += 1;
      insertBundleVersion({
        bundleId,
        version: row.current_version,
        label: versionLabel,
        description: nextDescription,
        items: nextItems,
      });
    }
    return getBundleById(bundleId);
  }

  const d = getDb();
  const duplicate = d.prepare('SELECT id FROM bundles WHERE id != ? AND lower(name) = lower(?)').get(bundleId, nextName);
  if (duplicate?.id) throw new Error('Bundle name already exists');

  let currentVersion = current.current_version;
  if (itemsChanged || descriptionChanged) {
    currentVersion += 1;
    insertBundleVersion({
      bundleId,
      version: currentVersion,
      label: versionLabel,
      description: nextDescription,
      items: nextItems,
    });
  }

  if (nameChanged || descriptionChanged || itemsChanged) {
    d.prepare(`
      UPDATE bundles
      SET name = ?, description = ?, current_version = ?, updated_at = unixepoch()
      WHERE id = ?
    `).run(nextName, nextDescription, currentVersion, bundleId);
  }

  return getBundleById(bundleId);
}

function deleteBundle(bundleId) {
  if (!bundleId) return false;

  if (isFallback()) {
    const previousLength = _fallbackStore.bundles.length;
    _fallbackStore.bundles = _fallbackStore.bundles.filter((entry) => entry.id !== bundleId);
    _fallbackStore.bundleVersions = _fallbackStore.bundleVersions.filter((entry) => entry.bundle_id !== bundleId);
    _fallbackStore.bundleApplications = _fallbackStore.bundleApplications.filter((entry) => entry.bundle_id !== bundleId);
    return previousLength !== _fallbackStore.bundles.length;
  }

  const info = getDb().prepare('DELETE FROM bundles WHERE id = ?').run(bundleId);
  return info.changes > 0;
}

function recordBundleApplication({
  bundleId,
  targetKind,
  targetRef,
  targetLabel,
  targetMeta = {},
  bundleVersion,
  lastStatus = 'applied',
  lastSummary = '',
}) {
  const payload = {
    id: genId(),
    bundle_id: bundleId,
    target_kind: targetKind,
    target_ref: targetRef,
    target_label: targetLabel,
    target_meta: JSON.stringify(targetMeta || {}),
    bundle_version: bundleVersion,
    applied_at: Date.now(),
    last_status: lastStatus,
    last_summary: lastSummary,
  };

  if (isFallback()) {
    const existing = _fallbackStore.bundleApplications.find((entry) =>
      entry.bundle_id === bundleId && entry.target_kind === targetKind && entry.target_ref === targetRef
    );
    if (existing) {
      Object.assign(existing, payload, { id: existing.id });
    } else {
      _fallbackStore.bundleApplications.push(payload);
    }
    return;
  }

  getDb().prepare(`
    INSERT INTO bundle_applications (
      id, bundle_id, target_kind, target_ref, target_label, target_meta, bundle_version, applied_at, last_status, last_summary
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), ?, ?)
    ON CONFLICT(bundle_id, target_kind, target_ref) DO UPDATE SET
      target_label = excluded.target_label,
      target_meta = excluded.target_meta,
      bundle_version = excluded.bundle_version,
      applied_at = unixepoch(),
      last_status = excluded.last_status,
      last_summary = excluded.last_summary
  `).run(
    payload.id,
    payload.bundle_id,
    payload.target_kind,
    payload.target_ref,
    payload.target_label,
    payload.target_meta,
    payload.bundle_version,
    payload.last_status,
    payload.last_summary
  );
}

// ─── History ──────────────────────────────────────────

function recordAction(action, assetName, details) {
  const payload = details || {};
  const assetId = payload.assetId || payload.asset_id || null;
  const serialized = JSON.stringify(payload);
  if (isFallback()) {
    const id = _fallbackStore.history.length + 1;
    _fallbackStore.history.push({
      id,
      action,
      asset_id: assetId,
      asset_name: assetName,
      details: serialized,
      created_at: Date.now(),
      reverted: 0,
    });
    return id;
  }
  const d = getDb();
  const info = d.prepare('INSERT INTO history (action, asset_id, asset_name, details) VALUES (?, ?, ?, ?)').run(
    action,
    assetId,
    assetName,
    serialized
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
  setEnvironmentReadOnly,
  getProjects,
  getProjectById,
  addProject,
  setProjectType,
  getSetting,
  setSetting,
  getAuditMode,
  setGlobalReadOnly,
  getSourceOfTruthMap,
  getSourceOfTruth,
  setSourceOfTruth,
  clearSourceOfTruth,
  getPolicies,
  getPolicyById,
  createPolicy,
  updatePolicy,
  deletePolicy,
  getBundles,
  getBundleById,
  createBundle,
  updateBundle,
  deleteBundle,
  recordBundleApplication,
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
