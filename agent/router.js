'use strict';

const { connect, disconnect, getConnections } = require('./connector');

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

    // POST /api/connect
    if (url.pathname === '/api/connect' && req.method === 'POST') {
      return readBody().then(body => {
        if (!body) return send(400, { ok: false, error: 'Invalid JSON' });
        const { name, tool, type } = body;
        const source = getSourceIndex()[name];
        if (!source) return send(404, { ok: false, error: 'Asset not found' });
        const result = connect(source.filePath, tool, type, name, projectRoot, source.raw);
        return send(result.ok ? 200 : 400, result);
      });
    }

    // POST /api/disconnect
    if (url.pathname === '/api/disconnect' && req.method === 'POST') {
      return readBody().then(body => {
        if (!body) return send(400, { ok: false, error: 'Invalid JSON' });
        const { name, tool, type } = body;
        const result = disconnect(tool, type, name, projectRoot);
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

    // GET /api/providers — list installed providers with asset counts
    if (url.pathname === '/api/providers' && req.method === 'GET') {
      const assets = getData();
      const providers = {};
      for (const a of assets) {
        for (const p of (a.providers || [])) {
          if (!providers[p]) providers[p] = { name: p, count: 0, types: {} };
          providers[p].count++;
          providers[p].types[a.type] = (providers[p].types[a.type] || 0) + 1;
        }
      }
      return send(200, { ok: true, data: Object.values(providers) });
    }

    // GET /api/categories — list categories with counts
    if (url.pathname === '/api/categories' && req.method === 'GET') {
      const assets = getData();
      const cats = {};
      for (const a of assets) {
        if (!cats[a.cat]) cats[a.cat] = 0;
        cats[a.cat]++;
      }
      return send(200, { ok: true, data: cats });
    }

    // GET /api/stats — summary stats
    if (url.pathname === '/api/stats' && req.method === 'GET') {
      const assets = getData();
      const stats = { total: assets.length, skill: 0, agent: 0, mcp: 0, instruction: 0, rule: 0, orchestrator: 0 };
      for (const a of assets) {
        if (stats[a.type] !== undefined) stats[a.type]++;
        if (a.isOrchestrator) stats.orchestrator++;
      }
      return send(200, { ok: true, data: stats });
    }

    // POST /api/rescan
    if (url.pathname === '/api/rescan' && req.method === 'POST') {
      const data = rescan();
      return send(200, { ok: true, count: data.length });
    }

    // 404
    send(404, { ok: false, error: 'Not found' });
  };
}

module.exports = { createRouter };
