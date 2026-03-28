'use strict';

const { connect, disconnect, getConnections } = require('./connector');
const store = require('./store');

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

    // 404
    send(404, { ok: false, error: 'Not found' });
  };
}

module.exports = { createRouter };
