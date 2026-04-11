'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ═══════════════════════════════════════════════════════
// 1. PARSER
// ═══════════════════════════════════════════════════════

describe('Parser — parseFrontmatter', () => {
  const { parseFrontmatter } = require('../agent/parser');

  it('parses standard frontmatter', () => {
    const content = `---
name: my-skill
description: "A test skill"
type: skill
---

# Body content`;
    const result = parseFrontmatter(content);
    assert.equal(result.name, 'my-skill');
    assert.equal(result.description, 'A test skill');
    assert.equal(result.type, 'skill');
  });

  it('returns empty object when no frontmatter', () => {
    const result = parseFrontmatter('# Just a heading\nSome text');
    assert.deepEqual(result, {});
  });

  it('returns empty object for empty string', () => {
    const result = parseFrontmatter('');
    assert.deepEqual(result, {});
  });

  it('handles single-quoted values', () => {
    const content = "---\nname: 'quoted-name'\n---\n";
    const result = parseFrontmatter(content);
    assert.equal(result.name, 'quoted-name');
  });

  it('skips multiline YAML markers (| and >)', () => {
    const content = "---\nname: test\ndesc: |\n---\n";
    const result = parseFrontmatter(content);
    assert.equal(result.name, 'test');
    assert.equal(result.desc, undefined);
  });

  it('handles unclosed frontmatter', () => {
    const content = "---\nname: broken\n";
    const result = parseFrontmatter(content);
    assert.deepEqual(result, {});
  });

  it('handles colons in values', () => {
    const content = "---\ndescription: Use this: for things\n---\n";
    const result = parseFrontmatter(content);
    assert.equal(result.description, 'Use this: for things');
  });
});

// ═══════════════════════════════════════════════════════
// 2. SCANNER
// ═══════════════════════════════════════════════════════

describe('Scanner — mock directory', () => {
  const { scanner } = require('../agent/scanner');
  const mockDir = path.join(__dirname, '_fixtures', 'mock-claude');

  before(() => {
    // Create mock .claude/ structure
    fs.mkdirSync(path.join(mockDir, 'commands'), { recursive: true });
    fs.mkdirSync(path.join(mockDir, 'agents'), { recursive: true });

    // Mock skill
    fs.writeFileSync(path.join(mockDir, 'commands', 'test-skill.md'), `---
name: test-skill
description: "A test skill for smoke tests"
---

# Test Skill

Do something useful.
`);

    // Mock agent
    fs.writeFileSync(path.join(mockDir, 'agents', 'test-agent.md'), `---
name: test-agent
description: "A test agent"
---

# Test Agent

Agent instructions here.
`);

    // Mock .mcp.json
    fs.writeFileSync(path.join(mockDir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        'test-server': {
          command: 'node',
          args: ['server.js'],
          description: 'Test MCP server',
        },
      },
    }));
  });

  after(() => {
    fs.rmSync(path.join(__dirname, '_fixtures'), { recursive: true, force: true });
  });

  it('discovers skills from commands/', () => {
    const result = scanner(mockDir);
    assert.ok(result.skills.length >= 1, 'Should find at least 1 skill');
    const skill = result.skills.find(s => s.name === 'test-skill');
    assert.ok(skill, 'Should find test-skill');
    assert.equal(skill.type, 'skill');
    assert.equal(skill.desc, 'A test skill for smoke tests');
    assert.ok(skill.providers.includes('claude'));
  });

  it('discovers agents from agents/', () => {
    const result = scanner(mockDir);
    const agent = result.agents.find(a => a.name === 'test-agent');
    assert.ok(agent, 'Should find test-agent');
    assert.equal(agent.type, 'agent');
    assert.ok(agent.providers.includes('claude'));
  });

  it('discovers MCP servers from .mcp.json', () => {
    const result = scanner(mockDir);
    const mcp = result.mcpServers.find(s => s.name === 'test-server');
    assert.ok(mcp, 'Should find test-server');
    assert.equal(mcp.type, 'mcp');
    assert.equal(mcp.command, 'node');
    assert.ok(mcp.providers.includes('claude'));
  });

  it('returns providers metadata', () => {
    const result = scanner(mockDir);
    assert.ok(result.providers, 'Should have providers');
    assert.ok(result.providers.claude, 'Should have claude provider');
    assert.equal(result.providers.claude.name, 'Claude');
  });

  it('handles nonexistent directory gracefully', () => {
    const result = scanner('/tmp/nonexistent-test-dir-' + Date.now());
    assert.ok(Array.isArray(result.skills));
    assert.ok(Array.isArray(result.agents));
    assert.ok(Array.isArray(result.mcpServers));
  });
});

// ═══════════════════════════════════════════════════════
// 3. CATEGORIZER
// ═══════════════════════════════════════════════════════

describe('Categorizer', () => {
  const { categorize } = require('../agent/categorizer');

  it('categorizes skills, agents, and MCP servers', () => {
    const raw = {
      skills: [
        { name: 'deploy-skill', desc: 'Deploy to production', type: 'skill', providers: ['claude'] },
      ],
      agents: [
        { name: 'code-reviewer', desc: 'Reviews code changes', type: 'agent', providers: ['claude'] },
      ],
      mcpServers: [
        { name: 'github-mcp', desc: 'GitHub integration', type: 'mcp', providers: ['claude'], command: 'node' },
      ],
      instructions: [],
      rules: [],
      providers: {},
    };

    const result = categorize(raw);
    assert.ok(result.length >= 3, 'Should produce at least 3 items');

    const skill = result.find(r => r.name === 'deploy-skill');
    assert.ok(skill, 'Should have deploy-skill');
    assert.ok(skill.cat, 'Should assign a category');

    const agent = result.find(r => r.name === 'code-reviewer');
    assert.ok(agent, 'Should have code-reviewer');

    const mcp = result.find(r => r.name === 'github-mcp');
    assert.ok(mcp, 'Should have github-mcp');
  });

  it('handles empty input', () => {
    const raw = { skills: [], agents: [], mcpServers: [], instructions: [], rules: [], providers: {} };
    const result = categorize(raw);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });
});

// ═══════════════════════════════════════════════════════
// 4. CAPABILITIES
// ═══════════════════════════════════════════════════════

describe('Capabilities', () => {
  const { buildCapabilities } = require('../agent/capabilities');

  it('classifies provider states across source, configured, available, missing, and unsupported', () => {
    const capabilities = buildCapabilities({
      name: 'test-skill',
      type: 'skill',
      filePath: '/tmp/test-skill.md',
      providers: ['claude', 'codex', 'gemini'],
      health: { hasBlocking: false, summary: '', issues: [] },
    }, {
      connections: {
        claude: { installed: true, supported: true, connected: true, isSource: true, targetPath: '/tmp/test-skill.md' },
        codex: { installed: true, supported: true, connected: true, isSymlink: true, targetPath: '/tmp/AGENTS.md' },
        gemini: { installed: true, supported: true, connected: false, targetPath: '/tmp/GEMINI.md' },
        cursor: { installed: false, supported: true, connected: false, targetPath: '/tmp/.cursor/rules/test-skill.md' },
        windsurf: { installed: true, supported: false, connected: false },
        copilot: { installed: true, supported: false, connected: false },
        continue_dev: { installed: false, supported: true, connected: false, targetPath: '/tmp/.continue/skills/test-skill.md' },
      },
    });

    assert.equal(capabilities.summary.active, 1);
    assert.equal(capabilities.summary.configured, 1);
    assert.equal(capabilities.summary.available, 1);
    assert.equal(capabilities.summary.missing, 2);
    assert.equal(capabilities.summary.unsupported, 2);

    const claude = capabilities.providers.find((entry) => entry.provider === 'claude');
    const codex = capabilities.providers.find((entry) => entry.provider === 'codex');
    const gemini = capabilities.providers.find((entry) => entry.provider === 'gemini');
    const cursor = capabilities.providers.find((entry) => entry.provider === 'cursor');
    const windsurf = capabilities.providers.find((entry) => entry.provider === 'windsurf');

    assert.equal(claude?.state, 'active');
    assert.equal(codex?.state, 'configured');
    assert.equal(gemini?.state, 'available');
    assert.equal(cursor?.state, 'missing');
    assert.equal(windsurf?.state, 'unsupported');
  });

  it('marks affected providers invalid when the asset has blocking health issues', () => {
    const capabilities = buildCapabilities({
      name: 'broken-server',
      type: 'mcp',
      filePath: '/tmp/.mcp.json',
      providers: ['claude'],
      health: {
        hasBlocking: true,
        summary: 'MCP config is missing a command.',
        issues: [{ level: 'blocking', code: 'missing_command', message: 'Missing command' }],
      },
    }, {
      connections: {
        claude: { installed: true, supported: true, connected: true, isSource: true, targetPath: '/tmp/.mcp.json' },
        codex: { installed: true, supported: true, connected: true, targetPath: '/tmp/.codex/config.json' },
        gemini: { installed: true, supported: true, connected: false, targetPath: '/tmp/.gemini/settings.json' },
        cursor: { installed: true, supported: false, connected: false },
        windsurf: { installed: false, supported: true, connected: false, targetPath: '/tmp/.windsurf/mcp.json' },
        copilot: { installed: true, supported: false, connected: false },
        continue_dev: { installed: false, supported: true, connected: false, targetPath: '/tmp/.continue/mcp.json' },
      },
    });

    assert.equal(capabilities.summary.invalid, 3);

    const claude = capabilities.providers.find((entry) => entry.provider === 'claude');
    const codex = capabilities.providers.find((entry) => entry.provider === 'codex');
    const gemini = capabilities.providers.find((entry) => entry.provider === 'gemini');

    assert.equal(claude?.state, 'invalid');
    assert.equal(codex?.state, 'invalid');
    assert.equal(gemini?.state, 'invalid');
    assert.match(claude?.detail || '', /missing a command/i);
  });
});

// ═══════════════════════════════════════════════════════
// 5. DIFF
// ═══════════════════════════════════════════════════════

describe('Diff — semantic comparison', () => {
  const { diffAssets } = require('../agent/diff');

  it('marks identical assets as same and excludes drift reasons', () => {
    const local = [{
      id: 'local-skill',
      name: 'shared-skill',
      type: 'skill',
      desc: 'Shared automation',
      cat: 'Productivity',
      tags: ['ops'],
      deps: ['github'],
      providers: ['claude', 'codex'],
      health: { status: 'ok', hasBlocking: false, issues: [] },
    }];
    const remote = [{
      id: 'remote-skill',
      name: 'shared-skill',
      type: 'skill',
      desc: 'Shared automation',
      cat: 'Productivity',
      tags: ['ops'],
      deps: ['github'],
      providers: ['claude', 'codex'],
      health: { status: 'ok', hasBlocking: false, issues: [] },
    }];

    const diff = diffAssets(local, remote);
    assert.equal(diff.onlyLocal.length, 0);
    assert.equal(diff.onlyRemote.length, 0);
    assert.equal(diff.sameCount, 1);
    assert.equal(diff.driftedCount, 0);
    assert.equal(diff.both[0].status, 'same');
    assert.deepEqual(diff.both[0].reasons, []);
  });

  it('marks semantic drift and reports content/provider/health reasons', () => {
    const diff = diffAssets([{
      id: 'local-mcp',
      name: 'repo-sync',
      type: 'mcp',
      desc: 'Local sync server',
      cat: 'Infrastructure',
      providers: ['claude', 'codex'],
      rawConfig: { command: 'uvx', args: ['repo-sync@latest'] },
      health: { status: 'ok', hasBlocking: false, issues: [] },
    }], [{
      id: 'remote-mcp',
      name: 'repo-sync',
      type: 'mcp',
      desc: 'Remote sync server',
      cat: 'Infrastructure',
      providers: ['claude'],
      rawConfig: { command: 'uvx', args: ['repo-sync@stable'] },
      health: {
        status: 'warning',
        hasBlocking: false,
        issues: [{ code: 'remote_only', level: 'warning', message: 'Remote only' }],
      },
    }]);

    assert.equal(diff.sameCount, 0);
    assert.equal(diff.driftedCount, 1);
    assert.equal(diff.both[0].status, 'drifted');
    assert.deepEqual(
      diff.both[0].reasons.map((reason) => reason.code).sort(),
      ['content_changed', 'health_changed', 'providers_changed']
    );
    assert.equal(diff.reasonCounts?.content_changed, 1);
    assert.equal(diff.reasonCounts?.providers_changed, 1);
    assert.equal(diff.reasonCounts?.health_changed, 1);
  });
});

// ═══════════════════════════════════════════════════════
// 6. STORE
// ═══════════════════════════════════════════════════════

describe('Store — SQLite operations', () => {
  const store = require('../agent/store');
  const testDbDir = path.join(__dirname, '_fixtures', 'test-db');

  before(() => {
    // Override DB path for testing
    fs.mkdirSync(testDbDir, { recursive: true });
    // Use a fresh DB by setting env
    process.env._AEM_TEST_DB = path.join(testDbDir, 'test.db');
  });

  after(() => {
    store.close();
    fs.rmSync(testDbDir, { recursive: true, force: true });
  });

  it('initializes store without errors', () => {
    // Store was already initialized in the scanner test, just verify it works
    store.initStore();
    const envId = store.getLocalEnvironmentId();
    assert.ok(envId, 'Should have a local environment ID');
  });

  it('upsert and retrieve assets', () => {
    const testAssets = [
      { name: 'store-test-skill', type: 'skill', desc: 'Test', cat: 'Testing', providers: ['claude'], tags: ['test'], deps: [] },
      { name: 'store-test-agent', type: 'agent', desc: 'Agent', cat: 'Testing', providers: ['claude'], tags: [], deps: [] },
    ];

    store.upsertAssets(testAssets, store.getLocalEnvironmentId());

    const all = store.getAssets();
    const skill = all.find(a => a.name === 'store-test-skill');
    assert.ok(skill, 'Should find upserted skill');
    assert.equal(skill.type, 'skill');
    assert.equal(skill.cat, 'Testing');
  });

  it('filters assets by type', () => {
    const skills = store.getAssets({ type: 'skill' });
    assert.ok(skills.every(a => a.type === 'skill'), 'All should be skills');
  });

  it('filters assets by search query', () => {
    const results = store.getAssets({ q: 'store-test' });
    assert.ok(results.length >= 2, 'Should find assets matching query');
  });

  it('getStats returns counts', () => {
    const stats = store.getStats();
    assert.ok(typeof stats.total === 'number');
    assert.ok(stats.total > 0);
  });

  it('getCategories returns category list', () => {
    const cats = store.getCategories();
    assert.ok(Array.isArray(cats));
  });

  it('records and retrieves history', () => {
    store.recordAction('test-action', 'test-asset', { detail: 'smoke test' });
    const history = store.getHistory(10);
    assert.ok(history.length > 0);
    const last = history[0];
    assert.equal(last.action, 'test-action');
    assert.equal(last.asset_name, 'test-asset');
  });

  it('getProviderStats returns provider breakdown', () => {
    const stats = store.getProviderStats();
    assert.ok(Array.isArray(stats));
  });
});

// ═══════════════════════════════════════════════════════
// 5. HEALTH
// ═══════════════════════════════════════════════════════

describe('Health — asset validation', () => {
  const { evaluateAssetHealth } = require('../agent/health');
  const fixtureRoot = path.join(__dirname, '_fixtures', 'health');

  before(() => {
    fs.mkdirSync(fixtureRoot, { recursive: true });
  });

  after(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('marks broken symlink assets as broken', () => {
    const target = path.join(fixtureRoot, 'missing-target.md');
    const link = path.join(fixtureRoot, 'broken-link.md');
    try { fs.unlinkSync(link); } catch {}
    fs.symlinkSync(target, link);

    const health = evaluateAssetHealth({
      type: 'skill',
      filePath: link,
      providers: ['claude'],
    });

    assert.equal(health.status, 'broken');
    assert.ok(health.issues.some((issue) => issue.code === 'broken_symlink'));
  });

  it('marks invalid MCP config as broken', () => {
    const health = evaluateAssetHealth({
      type: 'mcp',
      filePath: path.join(fixtureRoot, 'config.json'),
      providers: ['claude'],
      rawConfig: {
        command: ['node'],
      },
    });

    assert.equal(health.status, 'broken');
    assert.ok(health.issues.some((issue) => issue.code === 'invalid_command'));
  });
});

// ═══════════════════════════════════════════════════════
// 6. SNAPSHOTS — rollback safety
// ═══════════════════════════════════════════════════════

describe('Snapshots — rollback safety', () => {
  const snapshots = require('../agent/snapshots');
  const store = require('../agent/store');
  const fixtureRoot = path.join(__dirname, '_fixtures', 'snapshots');
  const opts = {
    getEnvironmentById: () => null,
  };

  before(() => {
    fs.mkdirSync(fixtureRoot, { recursive: true });
  });

  after(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('restores a local file to its pre-change state', async () => {
    const target = path.join(fixtureRoot, 'restore-me.md');
    fs.writeFileSync(target, 'before\n', 'utf-8');

    const session = await snapshots.beginSnapshot({
      action: 'edit',
      label: 'Edit restore-me',
      entries: [{ transport: 'local', targetPath: target }],
    }, opts);

    fs.writeFileSync(target, 'after\n', 'utf-8');

    const snapshot = await snapshots.finalizeSnapshot(session, opts);
    assert.ok(snapshot?.id, 'Should persist snapshot');

    const result = await snapshots.rollbackSnapshot(snapshot.id, opts);
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(target, 'utf-8'), 'before\n');

    const stored = store.getSnapshot(snapshot.id);
    assert.ok(stored?.rolled_back_at, 'Snapshot should be marked as rolled back');
  });

  it('blocks rollback when the target changed again after snapshot finalization', async () => {
    const target = path.join(fixtureRoot, 'conflict.md');
    fs.writeFileSync(target, 'v1\n', 'utf-8');

    const session = await snapshots.beginSnapshot({
      action: 'edit',
      label: 'Edit conflict',
      entries: [{ transport: 'local', targetPath: target }],
    }, opts);

    fs.writeFileSync(target, 'v2\n', 'utf-8');
    const snapshot = await snapshots.finalizeSnapshot(session, opts);
    assert.ok(snapshot?.id, 'Should persist snapshot');

    fs.writeFileSync(target, 'v3\n', 'utf-8');

    const result = await snapshots.rollbackSnapshot(snapshot.id, opts);
    assert.equal(result.ok, false);
    assert.match(result.error, /newer changes/i);
    assert.equal(fs.readFileSync(target, 'utf-8'), 'v3\n');
  });
});

// ═══════════════════════════════════════════════════════
// 7. ROUTER — API endpoints
// ═══════════════════════════════════════════════════════

describe('Router — API endpoints', () => {
  const { scanner } = require('../agent/scanner');
  const { categorize } = require('../agent/categorizer');
  const { startServer } = require('../agent/server');

  const mockDir = path.join(__dirname, '_fixtures', 'mock-claude-router');
  let server;
  let port;

  function fetch(urlPath) {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}${urlPath}`, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, body });
          }
        });
      }).on('error', reject);
    });
  }

  before(async () => {
    // Create minimal mock structure
    fs.mkdirSync(path.join(mockDir, 'commands'), { recursive: true });
    fs.writeFileSync(path.join(mockDir, 'commands', 'api-test.md'), `---
name: api-test
description: "API test skill"
---
# API Test
`);

    server = await startServer({
      port: 0,
      claudeDir: mockDir,
      projectRoot: __dirname,
      headless: true,
    });
    port = server.address().port;
  });

  after(() => {
    if (server) server.close();
    fs.rmSync(mockDir, { recursive: true, force: true });
  });

  it('GET /api/assets returns array', async () => {
    const { status, body } = await fetch('/api/assets');
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.ok(Array.isArray(body.data));
  });

  it('GET /api/stats returns counts', async () => {
    const { status, body } = await fetch('/api/stats');
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.ok(typeof body.data.total === 'number');
  });

  it('GET /api/providers returns provider list', async () => {
    const { status, body } = await fetch('/api/providers');
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.ok(Array.isArray(body.data));
  });

  it('GET /api/categories returns categories object', async () => {
    const { status, body } = await fetch('/api/categories');
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.equal(typeof body.data, 'object');
  });

  it('GET /api/environments returns at least local', async () => {
    const { status, body } = await fetch('/api/environments');
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.ok(body.data.length >= 1);
    assert.ok(body.data.some(e => e.type === 'local'));
  });

  it('GET /api/history returns array', async () => {
    const { status, body } = await fetch('/api/history');
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.ok(Array.isArray(body.data));
  });

  it('GET /api/projects returns array', async () => {
    const { status, body } = await fetch('/api/projects');
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.ok(Array.isArray(body.data));
  });

  it('GET /api/topology returns graph payload', async () => {
    const { status, body } = await fetch('/api/topology');
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.ok(Array.isArray(body.data.nodes));
    assert.ok(Array.isArray(body.data.edges));
    assert.ok(typeof body.data.summary?.nodeCount === 'number');
  });

  it('POST /api/rescan triggers rescan', async () => {
    const result = await new Promise((resolve, reject) => {
      const req = http.request(`http://localhost:${port}/api/rescan`, { method: 'POST' }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
          catch { resolve({ status: res.statusCode, body }); }
        });
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(result.status, 200);
    assert.ok(result.body.ok);
  });

  it('GET /api/assets?type=skill filters by type', async () => {
    const { status, body } = await fetch('/api/assets?type=skill');
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.ok(body.data.every(a => a.type === 'skill'));
  });

  it('GET /api/running-agents returns array', async () => {
    const { status, body } = await fetch('/api/running-agents');
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.ok(Array.isArray(body.data));
  });
});

// ═══════════════════════════════════════════════════════
// 8. SYNC ENGINE — project preview/apply
// ═══════════════════════════════════════════════════════

describe('Sync engine — project preview/apply', () => {
  const sync = require('../agent/sync');
  const fixtureRoot = path.join(__dirname, '_fixtures', 'sync');

  before(() => {
    fs.mkdirSync(fixtureRoot, { recursive: true });
  });

  after(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('previews and applies project file copy', async () => {
    const sourceProject = path.join(fixtureRoot, 'source-project');
    const targetProject = path.join(fixtureRoot, 'target-project');
    const sourceFile = path.join(sourceProject, '.claude', 'commands', 'ship-it.md');
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.mkdirSync(targetProject, { recursive: true });
    fs.writeFileSync(sourceFile, '# Ship it\n\nDeploy safely.\n');

    const request = {
      source: {
        assetId: 'skill:ship-it',
        name: 'ship-it',
        type: 'skill',
        filePath: sourceFile,
        providers: ['claude'],
        projectPath: sourceProject,
      },
      target: {
        kind: 'project',
        projectPath: targetProject,
        method: 'copy',
      },
    };

    const plan = await sync.previewSync(request, {
      resolveAsset: () => null,
      getEnvironmentById: () => null,
      getStoredAssetsByEnvironment: () => [],
      projectRoot: targetProject,
    });

    assert.equal(plan.canApply, true);
    assert.equal(plan.operations.length, 1);
    assert.equal(plan.operations[0].action, 'create');
    assert.match(plan.operations[0].targetPath, /\.claude\/commands\/ship-it\.md$/);

    const result = await sync.applySync(request, {
      resolveAsset: () => null,
      getEnvironmentById: () => null,
      getStoredAssetsByEnvironment: () => [],
      projectRoot: targetProject,
    });

    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(plan.operations[0].targetPath, 'utf-8'), '# Ship it\n\nDeploy safely.\n');
  });

  it('previews and applies project MCP merge from source config entry', async () => {
    const sourceProject = path.join(fixtureRoot, 'mcp-source-project');
    const targetProject = path.join(fixtureRoot, 'mcp-target-project');
    const sourceFile = path.join(sourceProject, '.mcp.json');
    fs.mkdirSync(sourceProject, { recursive: true });
    fs.mkdirSync(targetProject, { recursive: true });
    fs.writeFileSync(sourceFile, JSON.stringify({
      mcpServers: {
        'atlas-mcp': {
          command: 'node',
          args: ['atlas.js'],
        },
      },
    }, null, 2));

    const request = {
      source: {
        assetId: 'mcp:atlas-mcp',
        name: 'atlas-mcp',
        type: 'mcp',
        filePath: sourceFile,
        providers: ['claude'],
        projectPath: sourceProject,
      },
      target: {
        kind: 'project',
        projectPath: targetProject,
        method: 'copy',
      },
    };

    const plan = await sync.previewSync(request, {
      resolveAsset: () => null,
      getEnvironmentById: () => null,
      getStoredAssetsByEnvironment: () => [],
      projectRoot: targetProject,
    });

    assert.equal(plan.canApply, true);
    assert.equal(plan.operations[0].mode, 'json-entry-merge');
    assert.equal(plan.operations[0].action, 'create');

    const result = await sync.applySync(request, {
      resolveAsset: () => null,
      getEnvironmentById: () => null,
      getStoredAssetsByEnvironment: () => [],
      projectRoot: targetProject,
    });

    assert.equal(result.ok, true);
    const targetFile = path.join(targetProject, '.mcp.json');
    const targetDoc = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
    assert.deepEqual(targetDoc.mcpServers['atlas-mcp'], {
      command: 'node',
      args: ['atlas.js'],
    });
  });
});

// ═══════════════════════════════════════════════════════
// 9. CONNECTOR — utility functions
// ═══════════════════════════════════════════════════════

describe('Connector — utility functions', () => {
  const { availableTools, isToolInstalled, TOOL_TARGETS } = require('../agent/connector');

  it('availableTools returns tools for skill type', () => {
    const tools = availableTools('skill');
    assert.ok(Array.isArray(tools));
    assert.ok(tools.includes('claude'), 'Skills should be connectable to Claude');
  });

  it('availableTools returns tools for agent type', () => {
    const tools = availableTools('agent');
    assert.ok(Array.isArray(tools));
    assert.ok(tools.includes('claude'));
  });

  it('availableTools returns empty array for mcp type (MCP uses connectMcp directly)', () => {
    const tools = availableTools('mcp');
    assert.ok(Array.isArray(tools));
    // MCP connections go through connectMcp, not the symlink path
  });

  it('isToolInstalled returns boolean', () => {
    const result = isToolInstalled('claude');
    assert.equal(typeof result, 'boolean');
  });

  it('TOOL_TARGETS has all expected providers', () => {
    const expected = ['claude', 'codex', 'gemini', 'cursor', 'windsurf', 'copilot', 'continue_dev'];
    for (const provider of expected) {
      assert.ok(TOOL_TARGETS[provider], `Should have ${provider} in TOOL_TARGETS`);
    }
  });
});

// ═══════════════════════════════════════════════════════
// 10. MCP CLIENT — config lookup
// ═══════════════════════════════════════════════════════

describe('MCP Client — getMcpConfig', () => {
  const { getMcpConfig } = require('../agent/mcp-client');
  const mockDir = path.join(__dirname, '_fixtures', 'mock-mcp');

  before(() => {
    fs.mkdirSync(mockDir, { recursive: true });
    fs.writeFileSync(path.join(mockDir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        'lookup-test': {
          command: 'echo',
          args: ['hello'],
        },
      },
    }));
  });

  after(() => {
    fs.rmSync(path.join(__dirname, '_fixtures', 'mock-mcp'), { recursive: true, force: true });
  });

  it('finds MCP config by server name', () => {
    const result = getMcpConfig('lookup-test', mockDir, __dirname);
    assert.ok(result, 'Should find lookup-test config');
    assert.ok(result.config);
    assert.equal(result.config.command, 'echo');
  });

  it('returns null for unknown server', () => {
    const result = getMcpConfig('nonexistent-server', mockDir, __dirname);
    assert.equal(result, null);
  });
});

// ═══════════════════════════════════════════════════════
// 11. REMOTE PROJECTS — discovery and asset scan routes
// ═══════════════════════════════════════════════════════

describe('Remote projects — discovery and asset scan routes', () => {
  const store = require('../agent/store');
  const remote = require('../agent/remote');
  const { startServer } = require('../agent/server');

  let server;
  let remoteEnvId;
  let port;
  const originalDiscoverRemoteProjects = remote.discoverRemoteProjects;
  const originalScanRemoteProjectAssets = remote.scanRemoteProjectAssets;

  function request(method, urlPath, body) {
    return new Promise((resolve, reject) => {
      const req = http.request(`http://localhost:${port}${urlPath}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
      }, (res) => {
        let payload = '';
        res.on('data', (chunk) => { payload += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(payload) });
          } catch {
            resolve({ status: res.statusCode, body: payload });
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  before(async () => {
    remoteEnvId = store.addEnvironment({
      name: 'QA Remote',
      type: 'remote',
      ssh_host: 'example.test',
      ssh_user: 'roman',
      ssh_port: 22,
    });

    remote.discoverRemoteProjects = async (env, dirs) => {
      assert.equal(env.id, remoteEnvId);
      assert.deepEqual(dirs, ['~/Projects']);
      return [{
        name: 'remote-alpha',
        path: '/srv/apps/remote-alpha',
        providers: ['claude', 'codex'],
        assetCount: 2,
        environment_id: env.id,
        environment_type: 'remote',
        environment_name: env.name,
        assets: [],
      }];
    };

    remote.scanRemoteProjectAssets = async (env, projectPath) => {
      assert.equal(env.id, remoteEnvId);
      assert.equal(projectPath, '/srv/apps/remote-alpha');
      return [{
        id: `remote-project:${env.id}:skill:sync-docs`,
        name: 'sync-docs',
        desc: 'Remote project skill',
        type: 'skill',
        scope: 'project',
        projectPath,
        projectName: 'remote-alpha',
        environment_id: env.id,
        environment_type: 'remote',
        providers: ['claude'],
        health: {
          status: 'ok',
          issueCount: 0,
          hasBlocking: false,
          summary: 'Ready',
          issues: [],
        },
      }];
    };

    server = await startServer({
      port: 0,
      claudeDir: __dirname,
      projectRoot: __dirname,
      headless: true,
    });
    port = server.address().port;
  });

  after(() => {
    remote.discoverRemoteProjects = originalDiscoverRemoteProjects;
    remote.scanRemoteProjectAssets = originalScanRemoteProjectAssets;
    if (server) server.close();
  });

  it('discovers remote projects and persists them under the remote environment', async () => {
    const result = await request('POST', `/api/servers/${remoteEnvId}/projects/discover`, { dirs: ['~/Projects'] });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.data.length, 1);
    assert.equal(result.body.data[0].environment_id, remoteEnvId);
    assert.equal(result.body.data[0].environment_type, 'remote');

    const projects = store.getProjects({ environment_id: remoteEnvId });
    assert.equal(projects.length, 1);
    assert.equal(projects[0].path, '/srv/apps/remote-alpha');
  });

  it('returns remote project assets by project id', async () => {
    const [project] = store.getProjects({ environment_id: remoteEnvId });
    const result = await request('GET', `/api/projects/${project.id}/assets-by-id`);
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.data.length, 1);
    assert.equal(result.body.data[0].environment_type, 'remote');
    assert.equal(result.body.data[0].projectPath, '/srv/apps/remote-alpha');
  });
});
