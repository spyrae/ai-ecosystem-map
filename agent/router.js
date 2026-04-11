'use strict';

const path = require('path');
const fs = require('fs');
const { connect, disconnect, getConnections, getTargetPath, getMcpConfigPath } = require('./connector');
const store = require('./store');
const { discoverProjects, addProjectByPath, scanProjectAssets } = require('./projects');
const remote = require('./remote');
const mcpClient = require('./mcp-client');
const sync = require('./sync');
const batch = require('./batch');
const snapshots = require('./snapshots');
const { buildTopology } = require('./topology');
const {
  inferProviderFromAsset,
  inferRemoteTargetPath,
  inferLocalTargetPath,
  inferProjectAssetTarget,
} = require('./pathing');

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

    const resolveAsset = (assetRef, typeHint = null) => {
      if (!assetRef) return null;
      const sourceIndex = getSourceIndex();
      return sourceIndex[assetRef] || (typeHint ? sourceIndex[`${typeHint}:${assetRef}`] : null) || null;
    };

    const resolveInstructionPath = (provider, scope) => {
      const isProject = scope === 'project';
      const HOME = process.env.HOME || '';
      const projectBase = projectRoot || process.cwd();

      switch (provider) {
        case 'claude':
          return path.join(isProject ? projectBase : claudeDir, 'CLAUDE.md');
        case 'codex':
          return isProject ? path.join(projectBase, 'AGENTS.md') : path.join(HOME, '.codex', 'instructions.md');
        case 'gemini':
          return isProject ? path.join(projectBase, 'GEMINI.md') : path.join(HOME, '.gemini', 'instructions.md');
        case 'copilot':
          return path.join(projectBase, '.github', 'copilot-instructions.md');
        case 'cursor':
          return path.join(projectBase, '.cursorrules');
        case 'windsurf':
          return path.join(projectBase, '.windsurfrules');
        default:
          return null;
      }
    };

    const getEnvironmentById = (id) => store.getEnvironments().find((env) => env.id === id) || null;

    const beginWriteSnapshot = (config) => snapshots.beginSnapshot(config, { getEnvironmentById });
    const finalizeWriteSnapshot = (session) => snapshots.finalizeSnapshot(session, { getEnvironmentById });

    const listMcpPaths = (source) => [
      ...new Set([
        ...Object.values(source?.locations || {}).filter(Boolean),
        ...(source?.filePath ? [source.filePath] : []),
      ]),
    ];

    const buildDeleteDescriptors = (source) => {
      if (!source) return [];
      if (source.type === 'mcp') {
        return listMcpPaths(source).map((targetPath) => ({ transport: 'local', targetPath }));
      }
      return source.filePath ? [{ transport: 'local', targetPath: source.filePath }] : [];
    };

    const buildConnectDescriptors = (source, tool) => {
      if (!source || !tool) return [];
      if (source.type === 'mcp') {
        const targetPath = getMcpConfigPath(tool, projectRoot);
        return targetPath ? [{ transport: 'local', targetPath }] : [];
      }
      const targetPath = getTargetPath(tool, source.type, source.name, projectRoot);
      return targetPath ? [{ transport: 'local', targetPath }] : [];
    };

    const buildSyncDescriptors = (plan) => (plan?.operations || [])
      .filter((operation) => operation.action !== 'noop' && operation.targetPath)
      .map((operation) => ({
        transport: operation.mode.startsWith('remote-') ? 'remote' : 'local',
        environmentId: operation.mode.startsWith('remote-') ? plan?.target?.serverId || null : null,
        targetPath: operation.targetPath,
      }));

    const refreshRemoteEnvironment = async (environmentId) => {
      const env = getEnvironmentById(environmentId);
      if (!env || env.type !== 'remote') return;
      const assets = await remote.scanRemote(env);
      const { categorize } = require('./categorizer');
      const categorized = categorize({
        skills: assets.filter((asset) => asset.type === 'skill'),
        agents: assets.filter((asset) => asset.type === 'agent'),
        mcpServers: assets.filter((asset) => asset.type === 'mcp'),
        instructions: assets.filter((asset) => asset.type === 'instruction'),
        rules: assets.filter((asset) => asset.type === 'rule'),
      });
      store.upsertAssets(categorized, env.id);
    };

    const resolveCreatePath = (body) => {
      const HOME = process.env.HOME || '';
      const {
        name,
        type,
        provider = 'claude',
        scope = 'global',
      } = body;
      const isProject = scope === 'project';
      const projectBase = projectRoot || process.cwd();

      if (type === 'skill') {
        if (isProject) return path.join(projectBase, '.claude', 'commands', `${name}.md`);
        if (provider === 'codex') return path.join(HOME, '.codex', 'skills', 'public', `${name}.md`);
        if (provider === 'gemini') return path.join(HOME, '.gemini', 'skills', `${name}.md`);
        return path.join(claudeDir, 'commands', `${name}.md`);
      }

      if (type === 'agent') {
        if (isProject) return path.join(projectBase, '.claude', 'agents', `${name}.md`);
        if (provider === 'codex') return path.join(HOME, '.codex', 'agents', `${name}.md`);
        return path.join(claudeDir, 'agents', `${name}.md`);
      }

      if (type === 'rule') {
        if (provider === 'cursor') return path.join(projectBase, '.cursor', 'rules', `${name}.md`);
        if (provider === 'windsurf') return path.join(projectBase, '.windsurf', 'rules', `${name}.md`);
        if (provider === 'claude') return path.join(isProject ? projectBase : claudeDir, 'rules', `${name}.md`);
        return null;
      }

      if (type === 'instruction') {
        return resolveInstructionPath(provider, scope);
      }

      return null;
    };

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
      const assetRef = decodeURIComponent(url.pathname.split('/')[3]);
      const type = url.searchParams.get('type') || 'skill';
      const source = resolveAsset(assetRef, type);
      const connections = getConnections(
        source ? source.filePath : null,
        source ? source.type : type,
        source ? source.name : assetRef,
        projectRoot,
        source ? source.locations : null
      );
      return send(200, connections);
    }

    // ─── CRUD: Read / Update / Create / Delete ─────────

    // GET /api/assets/:name/content — read file content
    if (url.pathname.match(/^\/api\/assets\/(.+)\/content$/) && req.method === 'GET') {
      const assetRef = decodeURIComponent(url.pathname.split('/')[3]);
      const source = resolveAsset(assetRef, url.searchParams.get('type'));
      if (!source || !source.filePath) return send(404, { ok: false, error: 'Asset not found or no file' });
      try {
        if (source.type === 'mcp') {
          return send(200, {
            ok: true,
            content: JSON.stringify(source.rawConfig || {}, null, 2),
            filePath: source.filePath,
          });
        }
        const content = fs.readFileSync(source.filePath, 'utf-8');
        return send(200, { ok: true, content, filePath: source.filePath });
      } catch (err) {
        return send(500, { ok: false, error: 'Cannot read file: ' + err.message });
      }
    }

    // PUT /api/assets/:name/content — update file content
    if (url.pathname.match(/^\/api\/assets\/(.+)\/content$/) && req.method === 'PUT') {
      const assetRef = decodeURIComponent(url.pathname.split('/')[3]);
      return readBody().then(async (body) => {
        if (!body || typeof body.content !== 'string') return send(400, { ok: false, error: 'Provide content string' });
        const source = resolveAsset(assetRef, body.type || url.searchParams.get('type'));
        if (!source || !source.filePath) return send(404, { ok: false, error: 'Asset not found or no file' });
        try {
          const snapshotSession = await beginWriteSnapshot({
            action: 'edit',
            label: `Edit ${source.type} ${source.name}`,
            entries: [{ transport: 'local', targetPath: source.filePath }],
          });
          if (source.type === 'mcp') {
            const nextConfig = JSON.parse(body.content);
            const raw = fs.existsSync(source.filePath) ? JSON.parse(fs.readFileSync(source.filePath, 'utf-8')) : {};
            const key = raw.mcpServers ? 'mcpServers' : (raw.servers ? 'servers' : 'mcpServers');
            if (!raw[key]) raw[key] = {};
            raw[key][source.name] = nextConfig;
            fs.writeFileSync(source.filePath, JSON.stringify(raw, null, 2), 'utf-8');
            const snapshot = await finalizeWriteSnapshot(snapshotSession);
            store.recordAction('edit', source.name, { filePath: source.filePath, type: source.type, snapshotId: snapshot?.id || null });
            return send(200, { ok: true });
          }
          fs.writeFileSync(source.filePath, body.content, 'utf-8');
          const snapshot = await finalizeWriteSnapshot(snapshotSession);
          store.recordAction('edit', source.name, { filePath: source.filePath, type: source.type, snapshotId: snapshot?.id || null });
          // Watcher will trigger rescan automatically
          return send(200, { ok: true });
        } catch (err) {
          return send(500, { ok: false, error: 'Cannot write file: ' + err.message });
        }
      });
    }

    // POST /api/assets/create — create new asset file
    if (url.pathname === '/api/assets/create' && req.method === 'POST') {
      return readBody().then(async (body) => {
        if (!body || !body.name || !body.type) return send(400, { ok: false, error: 'Provide name and type' });
        const { name, type, content, provider, scope } = body;
        const HOME = process.env.HOME || '';

        if (type === 'mcp') {
          let mcpPath;
          if (provider === 'codex') mcpPath = path.join(HOME, '.codex', 'mcp.json');
          else if (provider === 'gemini') mcpPath = path.join(HOME, '.gemini', 'mcp.json');
          else if (provider === 'windsurf') mcpPath = path.join(HOME, '.windsurf', 'mcp.json');
          else if (provider === 'continue_dev') mcpPath = path.join(HOME, '.continue', 'config.json');
          else mcpPath = scope === 'project' ? path.join(projectRoot || process.cwd(), '.mcp.json') : path.join(claudeDir, '.mcp.json');

          let config = body.config;
          if (!config && typeof content === 'string' && content.trim()) {
            try {
              config = JSON.parse(content);
            } catch {
              return send(400, { ok: false, error: 'MCP config must be valid JSON' });
            }
          }
          if (!config || typeof config !== 'object' || Array.isArray(config)) {
            return send(400, { ok: false, error: 'Provide MCP config JSON with at least command or url' });
          }
          if (!config.command && !config.url && !config.type) {
            return send(400, { ok: false, error: 'MCP config must include command or url' });
          }

          try {
            const snapshotSession = await beginWriteSnapshot({
              action: 'create',
              label: `Create MCP ${name}`,
              entries: [{ transport: 'local', targetPath: mcpPath }],
            });
            const raw = fs.existsSync(mcpPath) ? JSON.parse(fs.readFileSync(mcpPath, 'utf-8')) : {};
            const key = provider === 'continue_dev' ? 'servers' : 'mcpServers';
            if (!raw[key]) raw[key] = {};
            if (raw[key][name]) return send(409, { ok: false, error: 'MCP server already exists' });
            raw[key][name] = config;
            const dir = path.dirname(mcpPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(mcpPath, JSON.stringify(raw, null, 2), 'utf-8');
            const snapshot = await finalizeWriteSnapshot(snapshotSession);
            store.recordAction('create', name, { type: 'mcp', provider, filePath: mcpPath, snapshotId: snapshot?.id || null });
            return send(200, { ok: true, filePath: mcpPath });
          } catch (err) {
            return send(500, { ok: false, error: err.message });
          }
        }

        const filePath = resolveCreatePath(body);
        if (!filePath) {
          return send(400, { ok: false, error: 'Unknown type: ' + type });
        }

        // Write the file
        try {
          const snapshotSession = await beginWriteSnapshot({
            action: 'create',
            label: `Create ${type} ${name}`,
            entries: [{ transport: 'local', targetPath: filePath }],
          });
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          if (fs.existsSync(filePath)) return send(409, { ok: false, error: 'File already exists' });
          fs.writeFileSync(filePath, content || defaultContent(name, type), 'utf-8');
          const snapshot = await finalizeWriteSnapshot(snapshotSession);
          store.recordAction('create', name, { type, provider, scope, filePath, snapshotId: snapshot?.id || null });
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
      return (async () => {
        const assetRef = decodeURIComponent(url.pathname.split('/')[3]);
        const type = url.searchParams.get('type');
        const source = resolveAsset(assetRef, type);

        if (type === 'mcp') {
          const mcpPaths = listMcpPaths(source);
          let removed = false;
          for (const mcpPath of mcpPaths) {
            if (!fs.existsSync(mcpPath)) continue;
            try {
              const snapshotSession = await beginWriteSnapshot({
                action: 'delete',
                label: `Delete MCP ${source.name}`,
                entries: [{ transport: 'local', targetPath: mcpPath }],
              });
              const raw = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
              const servers = raw.mcpServers || raw.servers || {};
              if (servers[source.name]) {
                delete servers[source.name];
                fs.writeFileSync(mcpPath, JSON.stringify(raw, null, 2), 'utf-8');
                const snapshot = await finalizeWriteSnapshot(snapshotSession);
                store.recordAction('delete', source.name, { type: 'mcp', filePath: mcpPath, snapshotId: snapshot?.id || null });
                removed = true;
              }
            } catch {
              // Skip broken config locations and keep scanning the rest.
            }
          }
          if (removed) {
            return send(200, { ok: true });
          }
          return send(404, { ok: false, error: 'MCP server not found in configs' });
        }

        if (!source || !source.filePath) return send(404, { ok: false, error: 'Asset not found' });
        try {
          const snapshotSession = await beginWriteSnapshot({
            action: 'delete',
            label: `Delete ${type || source.type} ${source.name}`,
            entries: [{ transport: 'local', targetPath: source.filePath }],
          });
          fs.unlinkSync(source.filePath);
          const snapshot = await finalizeWriteSnapshot(snapshotSession);
          store.recordAction('delete', source.name, {
            type: type || source.type || 'unknown',
            filePath: source.filePath,
            snapshotId: snapshot?.id || null,
          });
          return send(200, { ok: true });
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      })();
    }

    // POST /api/connect
    if (url.pathname === '/api/connect' && req.method === 'POST') {
      return readBody().then(async (body) => {
        if (!body) return send(400, { ok: false, error: 'Invalid JSON' });
        const { assetId, name, tool, type } = body;
        const source = resolveAsset(assetId || name, type);
        if (!source) return send(404, { ok: false, error: 'Asset not found' });
        const snapshotSession = await beginWriteSnapshot({
          action: 'connect',
          label: `Connect ${source.type} ${source.name} to ${tool}`,
          entries: buildConnectDescriptors(source, tool),
        });
        const result = connect(source.filePath, tool, source.type, source.name, projectRoot, source.rawConfig);
        if (result.ok) {
          const snapshot = await finalizeWriteSnapshot(snapshotSession);
          store.recordAction('connect', source.name, {
            tool,
            type: source.type,
            method: result.method,
            targetPath: result.targetPath || null,
            snapshotId: snapshot?.id || null,
          });
        }
        return send(result.ok ? 200 : 400, result);
      });
    }

    // POST /api/disconnect
    if (url.pathname === '/api/disconnect' && req.method === 'POST') {
      return readBody().then(async (body) => {
        if (!body) return send(400, { ok: false, error: 'Invalid JSON' });
        const { assetId, name, tool, type } = body;
        const source = resolveAsset(assetId || name, type);
        if (!source) return send(404, { ok: false, error: 'Asset not found' });
        const snapshotSession = await beginWriteSnapshot({
          action: 'disconnect',
          label: `Disconnect ${source.type} ${source.name} from ${tool}`,
          entries: buildConnectDescriptors(source, tool),
        });
        const result = disconnect(tool, source.type, source.name, projectRoot);
        if (result.ok) {
          const snapshot = await finalizeWriteSnapshot(snapshotSession);
          store.recordAction('disconnect', source.name, {
            tool,
            type: source.type,
            targetPath: getTargetPath(tool, source.type, source.name, projectRoot),
            snapshotId: snapshot?.id || null,
          });
        }
        return send(result.ok ? 200 : 400, result);
      });
    }

    // POST /api/batch/validate
    if (url.pathname === '/api/batch/validate' && req.method === 'POST') {
      return readBody().then((body) => {
        const result = batch.validateBatch(body, { resolveAsset, projectRoot });
        return send(200, result);
      });
    }

    // POST /api/batch/connect
    if (url.pathname === '/api/batch/connect' && req.method === 'POST') {
      return readBody().then(async (body) => {
        const items = Array.isArray(body?.items) ? body.items : [];
        const tool = body?.tool;
        const descriptors = items.flatMap((item) => buildConnectDescriptors(resolveAsset(item.assetId || item.name, item.type), tool));
        const snapshotSession = await beginWriteSnapshot({
          action: 'batch-connect',
          label: `Batch connect ${items.length} assets to ${tool}`,
          entries: descriptors,
          metadata: { total: items.length, tool },
        });
        const result = batch.connectBatch(body, { resolveAsset, projectRoot });
        let snapshot = null;
        if (result.successCount > 0) {
          snapshot = await finalizeWriteSnapshot(snapshotSession);
        }
        for (const entry of result.results.filter((item) => item.ok)) {
          store.recordAction('connect', entry.name, {
            tool,
            type: entry.type,
            batch: true,
            snapshotId: snapshot?.id || null,
          });
        }
        if (result.successCount > 0) rescan();
        return send(200, result);
      });
    }

    // POST /api/batch/disconnect
    if (url.pathname === '/api/batch/disconnect' && req.method === 'POST') {
      return readBody().then(async (body) => {
        const items = Array.isArray(body?.items) ? body.items : [];
        const tool = body?.tool;
        const descriptors = items.flatMap((item) => buildConnectDescriptors(resolveAsset(item.assetId || item.name, item.type), tool));
        const snapshotSession = await beginWriteSnapshot({
          action: 'batch-disconnect',
          label: `Batch disconnect ${items.length} assets from ${tool}`,
          entries: descriptors,
          metadata: { total: items.length, tool },
        });
        const result = batch.disconnectBatch(body, { resolveAsset, projectRoot });
        let snapshot = null;
        if (result.successCount > 0) {
          snapshot = await finalizeWriteSnapshot(snapshotSession);
        }
        for (const entry of result.results.filter((item) => item.ok)) {
          store.recordAction('disconnect', entry.name, {
            tool,
            type: entry.type,
            batch: true,
            snapshotId: snapshot?.id || null,
          });
        }
        if (result.successCount > 0) rescan();
        return send(200, result);
      });
    }

    // POST /api/batch/delete
    if (url.pathname === '/api/batch/delete' && req.method === 'POST') {
      return readBody().then(async (body) => {
        const items = Array.isArray(body?.items) ? body.items : [];
        const descriptors = items.flatMap((item) => buildDeleteDescriptors(resolveAsset(item.assetId || item.name, item.type)));
        const snapshotSession = await beginWriteSnapshot({
          action: 'batch-delete',
          label: `Batch delete ${items.length} assets`,
          entries: descriptors,
          metadata: { total: items.length },
        });
        const result = batch.deleteBatch(body, { resolveAsset, projectRoot });
        let snapshot = null;
        if (result.successCount > 0) {
          snapshot = await finalizeWriteSnapshot(snapshotSession);
        }
        for (const entry of result.results.filter((item) => item.ok)) {
          store.recordAction('delete', entry.name, {
            type: entry.type,
            filePath: entry.filePath,
            batch: true,
            snapshotId: snapshot?.id || null,
          });
        }
        if (result.successCount > 0) rescan();
        return send(200, result);
      });
    }

    // GET /api/connections (legacy compat)
    if (url.pathname === '/api/connections' && req.method === 'GET') {
      const name = url.searchParams.get('name');
      const assetId = url.searchParams.get('assetId');
      const type = url.searchParams.get('type') || 'skill';
      const source = resolveAsset(assetId || name, type);
      const connections = getConnections(
        source ? source.filePath : null,
        source ? source.type : type,
        source ? source.name : name,
        projectRoot,
        source ? source.locations : null
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

    // GET /api/topology — canonical graph across environments, projects, providers, agents and assets
    if (url.pathname === '/api/topology' && req.method === 'GET') {
      const localEnvironmentId = store.getLocalEnvironmentId();
      const topology = buildTopology({
        localAssets: getData(),
        storedAssets: store.getAssets(),
        environments: store.getEnvironments(),
        projects: store.getProjects(),
        runningAgents: store.getRunningAgents ? store.getRunningAgents() : [],
        localEnvironmentId,
      });
      return send(200, { ok: true, data: topology });
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

    // POST /api/history/:id/rollback
    if (url.pathname.match(/^\/api\/history\/(\d+)\/rollback$/) && req.method === 'POST') {
      const historyId = Number(url.pathname.split('/')[3]);
      const entry = store.getHistoryEntry(historyId);
      if (!entry) return send(404, { ok: false, error: 'History entry not found' });
      if (!entry.can_rollback || !entry.snapshot_id) {
        return send(400, { ok: false, error: 'Rollback is not available for this history entry' });
      }

      snapshots.rollbackSnapshot(entry.snapshot_id, { getEnvironmentById })
        .then(async (result) => {
          if (!result.ok) {
            return send(result.conflicts?.length ? 409 : 400, result);
          }
          store.markHistoryReverted(historyId);
          const remoteIds = [...new Set((result.snapshot?.entries || [])
            .map((snapshotEntry) => snapshotEntry.environmentId)
            .filter(Boolean))];
          for (const environmentId of remoteIds) {
            await refreshRemoteEnvironment(environmentId);
          }
          rescan();
          return send(200, { ok: true, historyId, snapshotId: entry.snapshot_id, restored: result.restored });
        })
        .catch((err) => send(500, { ok: false, error: err.message }));
      return;
    }

    // POST /api/undo
    if (url.pathname === '/api/undo' && req.method === 'POST') {
      const latest = store.undoLast();
      if (!latest.ok) return send(400, latest);

      snapshots.rollbackSnapshot(latest.history.snapshot_id, { getEnvironmentById })
        .then(async (result) => {
          if (!result.ok) {
            return send(result.conflicts?.length ? 409 : 400, result);
          }
          store.markHistoryReverted(latest.history.id);
          const remoteIds = [...new Set((result.snapshot?.entries || [])
            .map((snapshotEntry) => snapshotEntry.environmentId)
            .filter(Boolean))];
          for (const environmentId of remoteIds) {
            await refreshRemoteEnvironment(environmentId);
          }
          rescan();
          return send(200, {
            ok: true,
            historyId: latest.history.id,
            snapshotId: latest.history.snapshot_id,
            restored: result.restored,
          });
        })
        .catch((err) => send(500, { ok: false, error: err.message }));
      return;
    }

    // POST /api/rescan
    if (url.pathname === '/api/rescan' && req.method === 'POST') {
      const data = rescan();
      return send(200, { ok: true, count: data.length });
    }

    // POST /api/sync/preview — build sync preview plan
    if (url.pathname === '/api/sync/preview' && req.method === 'POST') {
      return readBody().then(async (body) => {
        if (!body?.source || !body?.target?.kind) {
          return send(400, { ok: false, error: 'source and target are required' });
        }
        try {
          const plan = await sync.previewSync(body, {
            resolveAsset,
            getEnvironmentById: (id) => store.getEnvironments().find((env) => env.id === id) || null,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
          });
          return send(200, { ok: true, plan });
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // POST /api/sync/apply — execute sync plan
    if (url.pathname === '/api/sync/apply' && req.method === 'POST') {
      return readBody().then(async (body) => {
        if (!body?.source || !body?.target?.kind) {
          return send(400, { ok: false, error: 'source and target are required' });
        }
        try {
          const previewPlan = await sync.previewSync(body, {
            resolveAsset,
            getEnvironmentById,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
          });
          const snapshotSession = await beginWriteSnapshot({
            action: 'sync',
            label: `Sync ${previewPlan.source?.type || body.source.type} ${previewPlan.source?.name || body.source.name}`,
            entries: buildSyncDescriptors(previewPlan),
            metadata: { target: previewPlan.target || body.target },
          });
          const result = await sync.applySync(body, {
            resolveAsset,
            getEnvironmentById,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
          });
          if (!result.ok) return send(400, result);
          const snapshot = await finalizeWriteSnapshot(snapshotSession);

          if (body.target.kind === 'server' && body.target.serverId) {
            try {
              await refreshRemoteEnvironment(body.target.serverId);
            } catch (err) {
              return send(500, { ok: false, error: `Sync applied but remote rescan failed: ${err.message}`, plan: result.plan });
            }
          }

          store.recordAction('sync', result.plan?.source?.name || body.source.name || 'asset', {
            target: result.plan?.target || body.target,
            applied: result.applied,
            skipped: result.skipped,
            snapshotId: snapshot?.id || null,
          });
          rescan();
          return send(200, result);
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // POST /api/batch/sync/preview — build batch sync preview plans
    if (url.pathname === '/api/batch/sync/preview' && req.method === 'POST') {
      return readBody().then(async (body) => {
        if (!Array.isArray(body?.requests) || body.requests.length === 0) {
          return send(400, { ok: false, error: 'requests array is required' });
        }
        try {
          const result = await batch.previewBatchSync(body, {
            resolveAsset,
            getEnvironmentById: (id) => store.getEnvironments().find((env) => env.id === id) || null,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
          });
          return send(200, result);
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // POST /api/batch/sync/apply — execute batch sync
    if (url.pathname === '/api/batch/sync/apply' && req.method === 'POST') {
      return readBody().then(async (body) => {
        if (!Array.isArray(body?.requests) || body.requests.length === 0) {
          return send(400, { ok: false, error: 'requests array is required' });
        }
        try {
          const preview = await batch.previewBatchSync(body, {
            resolveAsset,
            getEnvironmentById,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
          });
          const descriptors = preview.results.flatMap((entry) => entry.ok ? buildSyncDescriptors(entry.plan) : []);
          const snapshotSession = await beginWriteSnapshot({
            action: 'batch-sync',
            label: `Batch sync ${body.requests.length} assets`,
            entries: descriptors,
            metadata: { total: body.requests.length },
          });
          const result = await batch.applyBatchSync(body, {
            resolveAsset,
            getEnvironmentById,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
          });
          if (result.successCount > 0) {
            const snapshot = await finalizeWriteSnapshot(snapshotSession);
            store.recordAction('batch-sync', `${result.successCount} assets`, {
              total: result.total,
              applied: result.appliedCount,
              skipped: result.skippedCount,
              snapshotId: snapshot?.id || null,
            });
            const remoteIds = [...new Set(descriptors.map((entry) => entry.environmentId).filter(Boolean))];
            for (const environmentId of remoteIds) {
              await refreshRemoteEnvironment(environmentId);
            }
            rescan();
          }
          return send(200, result);
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // POST /api/assets/move — move/copy asset between projects
    if (url.pathname === '/api/assets/move' && req.method === 'POST') {
      return readBody().then(async (body) => {
        if (!body || !body.targetProjectPath || !body.type) {
          return send(400, { ok: false, error: 'targetProjectPath and type required' });
        }

        try {
          const previewPlan = await sync.previewSync({
            source: {
              assetId: body.assetId,
              name: body.name,
              type: body.type,
              filePath: body.sourcePath,
              providers: body.provider ? [body.provider] : [],
              rawConfig: body.config || null,
              projectPath: body.projectPath || null,
            },
            target: {
              kind: 'project',
              projectPath: body.targetProjectPath,
              method: body.method || 'copy',
            },
          }, {
            resolveAsset,
            getEnvironmentById,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
          });
          const snapshotSession = await beginWriteSnapshot({
            action: 'move',
            label: `Move ${body.type} ${body.name}`,
            entries: buildSyncDescriptors(previewPlan),
            metadata: { targetProjectPath: body.targetProjectPath, method: body.method || 'copy' },
          });
          const result = await sync.applySync({
            source: {
              assetId: body.assetId,
              name: body.name,
              type: body.type,
              filePath: body.sourcePath,
              providers: body.provider ? [body.provider] : [],
              rawConfig: body.config || null,
              projectPath: body.projectPath || null,
            },
            target: {
              kind: 'project',
              projectPath: body.targetProjectPath,
              method: body.method || 'copy',
            },
          }, {
            resolveAsset,
            getEnvironmentById,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
          });
          if (!result.ok) return send(400, result);
          const primaryOperation = result.plan.operations[0];
          const snapshot = await finalizeWriteSnapshot(snapshotSession);
          store.recordAction('move', result.plan.source.name || body.name, {
            from: result.plan.source.filePath || body.sourcePath || null,
            to: primaryOperation?.targetPath || body.targetProjectPath,
            method: body.method || 'copy',
            type: body.type,
            snapshotId: snapshot?.id || null,
          });
          rescan();
          return send(200, {
            ok: true,
            targetPath: primaryOperation?.targetPath || null,
            method: body.method || 'copy',
            plan: result.plan,
            applied: result.applied,
            skipped: result.skipped,
          });
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // ─── MCP Server Inspection ─────────────────────────

    // GET /api/mcp/:name/config — get MCP server config
    if (url.pathname.match(/^\/api\/mcp\/(.+)\/config$/) && req.method === 'GET') {
      const assetRef = decodeURIComponent(url.pathname.split('/')[3]);
      const source = resolveAsset(assetRef, 'mcp');
      const fallback = source ? null : mcpClient.getMcpConfig(assetRef, claudeDir, projectRoot);
      const config = source?.rawConfig || fallback?.config || null;
      const sourcePath = source?.filePath || fallback?.source || null;
      if (!config || !sourcePath) return send(404, { ok: false, error: 'MCP server not found in config' });
      return send(200, { ok: true, config, source: sourcePath });
    }

    // POST /api/mcp/:name/tools — connect and list tools
    if (url.pathname.match(/^\/api\/mcp\/(.+)\/tools$/) && req.method === 'POST') {
      const assetRef = decodeURIComponent(url.pathname.split('/')[3]);
      const source = resolveAsset(assetRef, 'mcp');
      const fallback = source ? null : mcpClient.getMcpConfig(assetRef, claudeDir, projectRoot);
      const config = source?.rawConfig || fallback?.config || null;
      if (!config) return send(404, { ok: false, error: 'MCP server not found' });
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
        const id = store.addProject(project.name, project.path);
        project.id = id;
        project.environment_id = store.getLocalEnvironmentId();
        project.environment_type = 'local';
        return send(200, { ok: true, data: project });
      });
    }

    // GET /api/projects/:id/assets — assets for a known project id (local or remote)
    if (url.pathname.match(/^\/api\/projects\/([^/]+)\/assets-by-id$/) && req.method === 'GET') {
      const projectId = decodeURIComponent(url.pathname.split('/')[3]);
      const project = store.getProjectById ? store.getProjectById(projectId) : null;
      if (!project) return send(404, { ok: false, error: 'Project not found' });

      if (project.environment_type === 'remote') {
        const env = getEnvironmentById(project.environment_id);
        if (!env) return send(404, { ok: false, error: 'Remote environment not found' });
        return remote.scanRemoteProjectAssets(env, project.path)
          .then((assets) => send(200, { ok: true, data: assets, total: assets.length }))
          .catch((err) => send(500, { ok: false, error: err.message }));
      }

      const assets = scanProjectAssets(project.path, {
        environmentId: project.environment_id || store.getLocalEnvironmentId(),
        environmentType: 'local',
      });
      return send(200, { ok: true, data: assets, total: assets.length });
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

    // GET /api/servers/:id/projects — list projects known for a remote server
    if (url.pathname.match(/^\/api\/servers\/([^/]+)\/projects$/) && req.method === 'GET') {
      const envId = url.pathname.split('/')[3];
      return send(200, { ok: true, data: store.getProjects({ environment_id: envId }) });
    }

    // POST /api/servers/:id/projects/discover — discover projects on remote server
    if (url.pathname.match(/^\/api\/servers\/([^/]+)\/projects\/discover$/) && req.method === 'POST') {
      const envId = url.pathname.split('/')[3];
      const env = getEnvironmentById(envId);
      if (!env || env.type !== 'remote') return send(404, { ok: false, error: 'Remote server not found' });

      return readBody()
        .then(async (body) => {
          const dirs = Array.isArray(body?.dirs) ? body.dirs : [];
          const projects = await remote.discoverRemoteProjects(env, dirs);
          const enriched = projects.map((project) => {
            const id = store.addProject(project.name, project.path, env.id);
            return {
              ...project,
              id,
            };
          });
          return send(200, { ok: true, data: enriched, count: enriched.length });
        })
        .catch((err) => send(500, { ok: false, error: err.message }));
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
      return readBody().then(async (body) => {
        if (!body || !body.name || !body.type) return send(400, { ok: false, error: 'Provide name and type' });
        const envs = store.getEnvironments();
        const env = envs.find(e => e.id === envId);
        if (!env) return send(404, { ok: false, error: 'Server not found' });

        try {
          const result = await sync.applySync({
            source: {
              assetId: body.assetId,
              name: body.name,
              type: body.type,
            },
            target: {
              kind: 'server',
              serverId: envId,
              direction: 'push',
            },
          }, {
            resolveAsset,
            getEnvironmentById: (id) => store.getEnvironments().find((entry) => entry.id === id) || null,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
          });
          if (!result.ok) return send(400, result);
          const primaryOperation = result.plan.operations[0];
          store.recordAction('push', body.name, { to: env.name, remotePath: primaryOperation?.targetPath || null });
          rescan();
          return send(200, { ok: true, remotePath: primaryOperation?.targetPath || null, plan: result.plan, applied: result.applied, skipped: result.skipped });
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
      });
    }

    // POST /api/servers/:id/pull — pull asset from remote
    if (url.pathname.match(/^\/api\/servers\/([^/]+)\/pull$/) && req.method === 'POST') {
      const envId = url.pathname.split('/')[3];
      return readBody().then(async (body) => {
        if (!body || !body.type || (!body.remotePath && !body.assetId && !body.name)) {
          return send(400, { ok: false, error: 'Provide type and remote asset reference' });
        }
        const envs = store.getEnvironments();
        const env = envs.find(e => e.id === envId);
        if (!env) return send(404, { ok: false, error: 'Server not found' });

        try {
          const result = await sync.applySync({
            source: {
              assetId: body.assetId,
              name: body.name,
              type: body.type,
              filePath: body.remotePath,
              environmentId: envId,
            },
            target: {
              kind: 'server',
              serverId: envId,
              direction: 'pull',
            },
          }, {
            resolveAsset,
            getEnvironmentById: (id) => store.getEnvironments().find((entry) => entry.id === id) || null,
            getStoredAssetsByEnvironment: (environmentId) => store.getAssets({ environment_id: environmentId }),
            projectRoot,
          });
          if (!result.ok) return send(400, result);
          const primaryOperation = result.plan.operations[0];
          store.recordAction('pull', body.name, { from: env.name, localPath: primaryOperation?.targetPath || null });
          rescan();
          return send(200, { ok: true, localPath: primaryOperation?.targetPath || null, plan: result.plan, applied: result.applied, skipped: result.skipped });
        } catch (err) {
          return send(500, { ok: false, error: err.message });
        }
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
