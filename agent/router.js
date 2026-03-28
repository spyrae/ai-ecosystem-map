'use strict';

const path = require('path');
const fs = require('fs');
const { connect, disconnect, getConnections } = require('./connector');
const store = require('./store');
const { discoverProjects, addProjectByPath, scanProjectAssets } = require('./projects');
const remote = require('./remote');
const mcpClient = require('./mcp-client');

/**
 * Create API router
 */
function createRouter(ctx) {
  const { getData, getSourceIndex, rescan, claudeDir, projectRoot } = ctx;

  return function router(req, res, url) {
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };

    const readBody = () => new Promise((resolve) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve(null); }
      });
    });

    // GET /api/assets — list all (with filters)
    if (url.pathname === '/api/assets' && req.method === 'GET') {
      let assets = getData();
      const type = url.searchParams.get('type');
      const provider = url.searchParams.get('provider');
      const category = url.searchParams.get('category');
      const search = url.searchParams.get('q');

      if (type) assets = assets.filter(a => a.type === type);
      if (provider) assets = assets.filter(a => (a.providers || []).includes(provider));
      if (category) assets = assets.filter(a => a.cat === category);
      if (search) {
        const q = search.toLowerCase();
        assets = assets.filter(a => {
          const text = `${a.name} ${a.desc} ${(a.tags || []).join(' ')} ${a.keywords || ''}`.toLowerCase();
          return text.includes(q);
        });
      }

      return send(200, { ok: true, data: assets, total: assets.length });
    }

    // GET /api/assets/:id/connections
    if (url.pathname.match(/^\/api\/assets\/(.+)\/connections$/) && req.method === 'GET') {
      const name = decodeURIComponent(url.pathname.split('/')[3]);
      const type = url.searchParams.get('type') || 'skill';
      const source = getSourceIndex()[name];
      const connections = getConnections(
        source ? source.filePath : null, type, name, projectRoot
      );
      return send(200, connections);
    }

    // ─── CRUD: Read / Update / Create / Delete ─────────

    // GET /api/assets/:name/content — read file content
    if (url.pathname.match(/^\/api\/assets\/(.+)\/content$/) && req.method === 'GET') {
      const name = decodeURIComponent(url.pathname.split('/')[3]);
      const source = getSourceIndex()[name];
      if (!source || !source.filePath) return send(404, { ok: false, error: 'Asset not found or no file' });
      try {
        const content = fs.readFileSync(source.filePath, 'utf-8');
        return send(200, { ok: true, content, filePath: source.filePath });
      } catch (err) {
        return send(500, { ok: false, error: 'Cannot read file: ' + err.message });
      }
    }

    // PUT /api/assets/:name/content — update file content
    if (url.pathname.match(/^\/api\/assets\/(.+)\/content$/) && req.method === 'PUT') {
      const name = decodeURIComponent(url.pathname.split('/')[3]);
      return readBody().then(body => {
        if (!body || typeof body.content !== 'string') return send(400, { ok: false, error: 'Provide content string' });
        const source = getSourceIndex()[name];
        if (!source || !source.filePath) return send(404, { ok: false, error: 'Asset not found or no file' });
        try {
          fs.writeFileSync(source.filePath, body.content, 'utf-8');
          store.recordAction('edit', name, { filePath: source.filePath });
          // Watcher will trigger rescan automatically
          return send(200, { ok: true });
        } catch (err) {
          return send(500, { ok: false, error: 'Cannot write file: ' + err.message });
        }
      });
    }

    // POST /api/assets/create — create new asset file
    if (url.pathname === '/api/assets/create' && req.method === 'POST') {
      return readBody().then(body => {
        if (!body || !body.name || !body.type) return send(400, { ok: false, error: 'Provide name and type' });
        const HOME = process.env.HOME || '';
        const { name, type, content, provider, scope } = body;
        const isProject = scope === 'project';

        // Determine file path based on type + provider + scope
        let filePath;
        if (type === 'skill') {
          // Skills: Claude format (.md in commands/), scope determines location
          const base = isProject ? path.join(projectRoot, '.claude', 'commands') : path.join(claudeDir, 'commands');
          filePath = path.join(base, name + '.md');
        } else if (type === 'agent') {
          const base = isProject ? path.join(projectRoot, '.claude', 'agents') : path.join(claudeDir, 'agents');
          filePath = path.join(base, name + '.md');
        } else if (type === 'mcp') {
          // MCP: add to appropriate .mcp.json based on provider
          let mcpPath;
          if (provider === 'cursor' || provider === 'windsurf') {
            mcpPath = path.join(projectRoot, '.mcp.json');
          } else {
            mcpPath = isProject ? path.join(projectRoot, '.mcp.json') : path.join(claudeDir, '.mcp.json');
          }
          try {
            const raw = fs.existsSync(mcpPath) ? JSON.parse(fs.readFileSync(mcpPath, 'utf-8')) : {};
            if (!raw.mcpServers) raw.mcpServers = {};
            if (raw.mcpServers[name]) return send(409, { ok: false, error: 'MCP server already exists' });
            raw.mcpServers[name] = body.config || { command: '', args: [] };
            fs.writeFileSync(mcpPath, JSON.stringify(raw, null, 2), 'utf-8');
            store.recordAction('create', name, { type: 'mcp', provider });
            return send(200, { ok: true, filePath: mcpPath });
          } catch (err) {
            return send(500, { ok: false, error: err.message });
          }
        } else if (type === 'rule') {
          const p = provider || 'cursor';
          const ruleProviders = {
            cursor: path.join(projectRoot, '.cursor', 'rules', name + '.md'),
            windsurf: path.join(projectRoot, '.windsurf', 'rules', name + '.md'),
            claude: path.join(isProject ? path.join(projectRoot, '.claude') : claudeDir, 'rules', name + '.md'),
            codex: path.join(HOME, '.codex', 'rules', name + '.md'),
          };
          filePath = ruleProviders[p];
          if (!filePath) return send(400, { ok: false, error: 'Unknown rule provider: ' + p });
        } else if (type === 'instruction') {
          // Instructions: provider determines filename
          const instrMap = {
            claude: 'CLAUDE.md',
            codex: 'AGENTS.md',
            gemini: 'GEMINI.md',
            copilot: path.join('.github', 'copilot-instructions.md'),
            cursor: '.cursorrules',
            windsurf: '.windsurfrules',
          };
          const fileName = instrMap[provider] || name;
          filePath = path.join(projectRoot, fileName);
        } else {
          return send(400, { ok: false, error: 'Unknown type: ' + type });
        }

        // Write the file
        try {
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          if (fs.existsSync(filePath)) return send(409, { ok: false, error: 'File already exists' });
          fs.writeFileSync(filePath, content || defaultContent(name, type), 'utf-8');
          store.recordAction('create', name, { type, provider, scope, filePath });
          return send(200, { ok: true, filePath });
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // POST /api/generate — AI-generate asset content
    if (url.pathname === '/api/generate' && req.method === 'POST') {
      return readBody().then(body => {
        if (!body || !body.description || !body.type) {
          return send(400, { ok: false, error: 'Provide description and type' });
        }
        return generateAssetContent(body.type, body.name || 'untitled', body.description)
          .then(content => send(200, { ok: true, content }))
          .catch(err => send(500, { ok: false, error: err.message }));
      });
    }

    // DELETE /api/assets/:name — delete asset
    if (url.pathname.match(/^\/api\/assets\/([^/]+)$/) && req.method === 'DELETE') {
      const name = decodeURIComponent(url.pathname.split('/')[3]);
      const type = url.searchParams.get('type');
      const source = getSourceIndex()[name];

      if (type === 'mcp') {
        // Remove from .mcp.json
        const mcpPaths = [
          path.join(claudeDir, '.mcp.json'),
          path.join(claudeDir, 'mcp.json'),
          path.join(projectRoot, '.mcp.json'),
        ];
        let removed = false;
        for (const mcpPath of mcpPaths) {
          if (!fs.existsSync(mcpPath)) continue;
          try {
            const raw = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
            const servers = raw.mcpServers || raw.servers || {};
            if (servers[name]) {
              delete servers[name];
              fs.writeFileSync(mcpPath, JSON.stringify(raw, null, 2), 'utf-8');
              removed = true;
              break;
            }
          } catch { /* skip */ }
        }
        if (removed) {
          store.recordAction('delete', name, { type: 'mcp' });
          return send(200, { ok: true });
        }
        return send(404, { ok: false, error: 'MCP server not found in configs' });
      }

      // File-based assets
      if (!source || !source.filePath) return send(404, { ok: false, error: 'Asset not found' });
      try {
        fs.unlinkSync(source.filePath);
        store.recordAction('delete', name, { type: type || 'unknown', filePath: source.filePath });
        return send(200, { ok: true });
      } catch (err) {
        return send(500, { ok: false, error: err.message });
      }
    }

    // POST /api/connect
    if (url.pathname === '/api/connect' && req.method === 'POST') {
      return readBody().then(body => {
        if (!body) return send(400, { ok: false, error: 'Invalid JSON' });
        const { name, tool, type } = body;
        const source = getSourceIndex()[name];
        if (!source) return send(404, { ok: false, error: 'Asset not found' });
        const result = connect(source.filePath, tool, type, name, projectRoot, source.raw);
        if (result.ok) store.recordAction('connect', name, { tool, type, method: result.method });
        return send(result.ok ? 200 : 400, result);
      });
    }

    // POST /api/disconnect
    if (url.pathname === '/api/disconnect' && req.method === 'POST') {
      return readBody().then(body => {
        if (!body) return send(400, { ok: false, error: 'Invalid JSON' });
        const { name, tool, type } = body;
        const result = disconnect(tool, type, name, projectRoot);
        if (result.ok) store.recordAction('disconnect', name, { tool, type });
        return send(result.ok ? 200 : 400, result);
      });
    }

    // GET /api/connections (legacy compat)
    if (url.pathname === '/api/connections' && req.method === 'GET') {
      const name = url.searchParams.get('name');
      const type = url.searchParams.get('type') || 'skill';
      const source = getSourceIndex()[name];
      const connections = getConnections(
        source ? source.filePath : null, type, name, projectRoot
      );
      return send(200, connections);
    }

    // GET /api/providers — from store
    if (url.pathname === '/api/providers' && req.method === 'GET') {
      return send(200, { ok: true, data: store.getProviderStats() });
    }

    // GET /api/categories — from store
    if (url.pathname === '/api/categories' && req.method === 'GET') {
      const cats = {};
      for (const row of store.getCategories()) cats[row.category] = row.count;
      return send(200, { ok: true, data: cats });
    }

    // GET /api/stats — summary stats
    if (url.pathname === '/api/stats' && req.method === 'GET') {
      return send(200, { ok: true, data: store.getStats() });
    }

    // GET /api/environments
    if (url.pathname === '/api/environments' && req.method === 'GET') {
      return send(200, { ok: true, data: store.getEnvironments() });
    }

    // GET /api/history
    if (url.pathname === '/api/history' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit')) || 50;
      return send(200, { ok: true, data: store.getHistory(limit) });
    }

    // POST /api/undo
    if (url.pathname === '/api/undo' && req.method === 'POST') {
      const result = store.undoLast();
      return send(result.ok ? 200 : 400, result);
    }

    // POST /api/rescan
    if (url.pathname === '/api/rescan' && req.method === 'POST') {
      const data = rescan();
      return send(200, { ok: true, count: data.length });
    }

    // ─── MCP Server Inspection ─────────────────────────

    // GET /api/mcp/:name/config — get MCP server config
    if (url.pathname.match(/^\/api\/mcp\/(.+)\/config$/) && req.method === 'GET') {
      const name = decodeURIComponent(url.pathname.split('/')[3]);
      const result = mcpClient.getMcpConfig(name, claudeDir, projectRoot);
      if (!result) return send(404, { ok: false, error: 'MCP server not found in config' });
      return send(200, { ok: true, ...result });
    }

    // POST /api/mcp/:name/tools — connect and list tools
    if (url.pathname.match(/^\/api\/mcp\/(.+)\/tools$/) && req.method === 'POST') {
      const name = decodeURIComponent(url.pathname.split('/')[3]);
      const result = mcpClient.getMcpConfig(name, claudeDir, projectRoot);
      if (!result) return send(404, { ok: false, error: 'MCP server not found' });

      const config = result.config;
      const isHttp = config.type === 'http' || config.type === 'sse' || config.url;

      const promise = isHttp
        ? mcpClient.listHttpTools(config.url || `http://localhost:${config.port || 3000}`)
        : mcpClient.listMcpTools(config);

      return promise
        .then(tools => send(200, { ok: true, tools, count: tools.length }))
        .catch(err => send(500, { ok: false, error: err.message }));
    }

    // ─── Running Agents ──────────────────────────────────

    // GET /api/running-agents — list configured running agents
    if (url.pathname === '/api/running-agents' && req.method === 'GET') {
      const agents = store.getRunningAgents ? store.getRunningAgents() : [];
      return send(200, { ok: true, data: agents });
    }

    // POST /api/running-agents/add — add a running agent endpoint
    if (url.pathname === '/api/running-agents/add' && req.method === 'POST') {
      return readBody().then(body => {
        if (!body || !body.name || !body.url) return send(400, { ok: false, error: 'Provide name and url' });
        const id = store.addRunningAgent ? store.addRunningAgent(body) : null;
        if (!id) return send(500, { ok: false, error: 'Store not ready' });
        return send(200, { ok: true, id });
      });
    }

    // DELETE /api/running-agents/:id
    if (url.pathname.match(/^\/api\/running-agents\/([^/]+)$/) && req.method === 'DELETE') {
      const id = url.pathname.split('/')[3];
      if (store.removeRunningAgent) store.removeRunningAgent(id);
      return send(200, { ok: true });
    }

    // POST /api/running-agents/:id/tools — connect and list tools
    if (url.pathname.match(/^\/api\/running-agents\/([^/]+)\/tools$/) && req.method === 'POST') {
      const id = url.pathname.split('/')[3];
      const agents = store.getRunningAgents ? store.getRunningAgents() : [];
      const agent = agents.find(a => a.id === id);
      if (!agent) return send(404, { ok: false, error: 'Agent not found' });

      return mcpClient.listHttpTools(agent.url)
        .then(tools => send(200, { ok: true, tools, count: tools.length }))
        .catch(err => send(500, { ok: false, error: err.message }));
    }

    // ─── Projects ────────────────────────────────────

    // GET /api/projects — list known projects
    if (url.pathname === '/api/projects' && req.method === 'GET') {
      return send(200, { ok: true, data: store.getProjects() });
    }

    // POST /api/projects/discover — scan directories for projects
    if (url.pathname === '/api/projects/discover' && req.method === 'POST') {
      return readBody().then(body => {
        const dirs = (body && body.dirs) || [];
        if (!dirs.length) return send(400, { ok: false, error: 'Provide dirs array' });
        const projects = discoverProjects(dirs);
        // Persist discovered projects
        for (const p of projects) {
          store.addProject(p.name, p.path);
        }
        return send(200, { ok: true, data: projects });
      });
    }

    // POST /api/projects/add — add a single project by path
    if (url.pathname === '/api/projects/add' && req.method === 'POST') {
      return readBody().then(body => {
        if (!body || !body.path) return send(400, { ok: false, error: 'Provide path' });
        const project = addProjectByPath(body.path);
        if (!project) return send(404, { ok: false, error: 'Path not found' });
        store.addProject(project.name, project.path);
        return send(200, { ok: true, data: project });
      });
    }

    // GET /api/projects/:path/assets — assets for a specific project
    if (url.pathname.match(/^\/api\/projects\/(.+)\/assets$/) && req.method === 'GET') {
      const projectPath = decodeURIComponent(url.pathname.split('/assets')[0].replace('/api/projects/', ''));
      const assets = scanProjectAssets(projectPath);
      return send(200, { ok: true, data: assets, total: assets.length });
    }

    // ─── Remote Servers ────────────────────────────────

    // GET /api/servers — list environments (local + remote)
    if (url.pathname === '/api/servers' && req.method === 'GET') {
      return send(200, { ok: true, data: store.getEnvironments() });
    }

    // POST /api/servers/add — add a remote server
    if (url.pathname === '/api/servers/add' && req.method === 'POST') {
      return readBody().then(body => {
        if (!body || !body.name || !body.ssh_host || !body.ssh_user) {
          return send(400, { ok: false, error: 'Provide name, ssh_host, ssh_user' });
        }
        const id = store.addEnvironment({
          name: body.name,
          type: 'remote',
          ssh_host: body.ssh_host,
          ssh_port: body.ssh_port || 22,
          ssh_user: body.ssh_user,
          ssh_key_path: body.ssh_key_path || null,
        });
        return send(200, { ok: true, id });
      });
    }

    // POST /api/servers/:id/test — test SSH connection
    if (url.pathname.match(/^\/api\/servers\/([^/]+)\/test$/) && req.method === 'POST') {
      const envId = url.pathname.split('/')[3];
      const envs = store.getEnvironments();
      const env = envs.find(e => e.id === envId);
      if (!env) return send(404, { ok: false, error: 'Server not found' });
      return remote.testConnection(env)
        .then(result => send(200, { ok: true, ...result }))
        .catch(err => send(500, { ok: false, error: err.message }));
    }

    // POST /api/servers/:id/scan — scan remote server for assets
    if (url.pathname.match(/^\/api\/servers\/([^/]+)\/scan$/) && req.method === 'POST') {
      const envId = url.pathname.split('/')[3];
      const envs = store.getEnvironments();
      const env = envs.find(e => e.id === envId);
      if (!env || env.type !== 'remote') return send(404, { ok: false, error: 'Remote server not found' });
      return remote.scanRemote(env)
        .then(assets => {
          const { categorize } = require('./categorizer');
          const categorized = categorize({
            skills: assets.filter(a => a.type === 'skill'),
            agents: assets.filter(a => a.type === 'agent'),
            mcpServers: assets.filter(a => a.type === 'mcp'),
            instructions: assets.filter(a => a.type === 'instruction'),
            rules: assets.filter(a => a.type === 'rule'),
          });
          store.upsertAssets(categorized, envId);
          return send(200, { ok: true, data: assets, count: assets.length });
        })
        .catch(err => send(500, { ok: false, error: err.message }));
    }

    // GET /api/servers/:id/diff — diff local vs remote
    if (url.pathname.match(/^\/api\/servers\/([^/]+)\/diff$/) && req.method === 'GET') {
      const envId = url.pathname.split('/')[3];
      const localEnvId = store.getLocalEnvironmentId();
      const localAssets = store.getAssets({ environment_id: localEnvId });
      const remoteAssets = store.getAssets({ environment_id: envId });
      const diff = remote.diffAssets(localAssets, remoteAssets);
      return send(200, { ok: true, data: diff });
    }

    // POST /api/servers/:id/push — push asset to remote
    if (url.pathname.match(/^\/api\/servers\/([^/]+)\/push$/) && req.method === 'POST') {
      const envId = url.pathname.split('/')[3];
      return readBody().then(body => {
        if (!body || !body.name || !body.type) return send(400, { ok: false, error: 'Provide name and type' });
        const envs = store.getEnvironments();
        const env = envs.find(e => e.id === envId);
        if (!env) return send(404, { ok: false, error: 'Server not found' });

        const source = getSourceIndex()[body.name];
        if (!source || !source.filePath) return send(404, { ok: false, error: 'Asset not found locally' });

        if (body.type !== 'skill' && body.type !== 'agent') {
          return send(400, { ok: false, error: 'Push only supports skill and agent types' });
        }

        return remote.sshConnect(env)
          .then(client => remote.sshExec(client, 'echo $HOME').then(home => ({ client, home: home.trim() })))
          .then(({ client, home }) => {
            const remotePath = body.type === 'skill'
              ? `${home}/.claude/commands/${path.basename(source.filePath)}`
              : `${home}/.claude/agents/${path.basename(source.filePath)}`;
            return remote.scpPush(client, source.filePath, remotePath).then(() => remotePath);
          })
          .then(remotePath => {
            store.recordAction('push', body.name, { to: env.name, remotePath });
            return send(200, { ok: true, remotePath });
          })
          .catch(err => send(500, { ok: false, error: err.message }));
      });
    }

    // POST /api/servers/:id/pull — pull asset from remote
    if (url.pathname.match(/^\/api\/servers\/([^/]+)\/pull$/) && req.method === 'POST') {
      const envId = url.pathname.split('/')[3];
      return readBody().then(body => {
        if (!body || !body.remotePath || !body.type) return send(400, { ok: false, error: 'Provide remotePath and type' });
        const envs = store.getEnvironments();
        const env = envs.find(e => e.id === envId);
        if (!env) return send(404, { ok: false, error: 'Server not found' });

        if (body.type !== 'skill' && body.type !== 'agent') {
          return send(400, { ok: false, error: 'Pull only supports skill and agent types' });
        }

        const HOME = process.env.HOME || '';
        const fileName = path.basename(body.remotePath);
        const localPath = body.type === 'skill'
          ? path.join(HOME, '.claude', 'commands', fileName)
          : path.join(HOME, '.claude', 'agents', fileName);

        return remote.sshConnect(env)
          .then(client => remote.scpPull(client, body.remotePath, localPath))
          .then(() => {
            store.recordAction('pull', fileName.replace('.md', ''), { from: env.name, localPath });
            return send(200, { ok: true, localPath });
          })
          .catch(err => send(500, { ok: false, error: err.message }));
      });
    }

    // 404
    send(404, { ok: false, error: 'Not found' });
  };
}

/**
 * Generate asset content using LLM API.
 * Supports ANTHROPIC_API_KEY or OPENAI_API_KEY.
 */
async function generateAssetContent(type, name, description) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const systemPrompts = {
    skill: `You are an expert at creating Claude Code skills (slash commands).
Generate a production-quality skill file in Markdown with YAML frontmatter.
The frontmatter MUST have: name (kebab-case), description (purpose + triggers + negative triggers, max 1024 chars).
The body should have: clear imperative steps, output format template, common mistakes section if relevant.
Keep body under 300 lines. Use concrete templates over prose.`,
    agent: `You are an expert at creating Claude Code agent definitions.
Generate a production-quality agent file in Markdown with YAML frontmatter.
The frontmatter MUST have: name (kebab-case), description (what the agent does), model (sonnet or opus).
The body should define: the agent's role, available tools, workflow steps, output expectations.`,
    rule: `You are an expert at creating IDE rules for AI coding assistants.
Generate a clear, concise rules file in Markdown.
Include: project context, coding guidelines, patterns to follow, things to avoid.`,
    instruction: `You are an expert at creating instruction files for AI coding assistants.
Generate a clear instruction file in Markdown.
Include: project context, tech stack, key rules, coding patterns.`,
  };

  const prompt = `Create a ${type} named "${name}".

User's description: ${description}

Generate the complete file content. Output ONLY the file content, no explanation.`;

  if (anthropicKey) {
    const https = require('https');
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompts[type] || systemPrompts.skill,
        messages: [{ role: 'user', content: prompt }],
      });
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (parsed.content && parsed.content[0]) {
              resolve(parsed.content[0].text);
            } else {
              reject(new Error(parsed.error?.message || 'No content in response'));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  if (openaiKey) {
    const https = require('https');
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompts[type] || systemPrompts.skill },
          { role: 'user', content: prompt },
        ],
        max_tokens: 4096,
      });
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (parsed.choices && parsed.choices[0]) {
              resolve(parsed.choices[0].message.content);
            } else {
              reject(new Error(parsed.error?.message || 'No content'));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  throw new Error('Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable to enable AI generation');
}

function defaultContent(name, type) {
  if (type === 'skill') {
    return `---\nname: ${name}\ndescription: ""\n---\n\n# ${name}\n\n`;
  }
  if (type === 'agent') {
    return `---\nname: ${name}\ndescription: ""\nmodel: sonnet\n---\n\n# ${name}\n\n`;
  }
  if (type === 'rule') {
    return `# ${name}\n\n`;
  }
  return `# ${name}\n\n`;
}

module.exports = { createRouter };
