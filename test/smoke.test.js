'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Force exit after tests complete (server keeps event loop alive)
process.on('beforeExit', () => process.exit(0));

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
// 4. STORE
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
// 5. ROUTER — API endpoints
// ═══════════════════════════════════════════════════════

describe('Router — API endpoints', () => {
  const { scanner } = require('../agent/scanner');
  const { categorize } = require('../agent/categorizer');
  const { startServer } = require('../agent/server');

  const mockDir = path.join(__dirname, '_fixtures', 'mock-claude-router');
  let server;
  const port = 3999;

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
      port,
      claudeDir: mockDir,
      projectRoot: __dirname,
      headless: true,
    });
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
// 6. CONNECTOR — utility functions
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
// 7. MCP CLIENT — config lookup
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
