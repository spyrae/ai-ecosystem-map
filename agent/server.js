'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const { createRouter } = require('./router');
const { createWatcher } = require('./watcher');

/**
 * Start the agent server.
 * @param {object} opts - { port, claudeDir, projectRoot, open, headless }
 * @returns {Promise<http.Server>}
 */
async function startServer(opts) {
  const { port = 3000, claudeDir, projectRoot, headless = false } = opts;

  // Initial scan
  const { scanner } = require('./scanner');
  const { categorize } = require('./categorizer');
  const raw = scanner(claudeDir);
  let data = categorize(raw);

  // Build source index for connector
  const sourceIndex = {};
  function rebuildIndex(rawData) {
    for (const key of Object.keys(sourceIndex)) delete sourceIndex[key];
    for (const item of [...rawData.skills, ...rawData.agents, ...(rawData.instructions || []), ...(rawData.rules || [])]) {
      if (item.filePath) sourceIndex[item.name] = item;
    }
    for (const item of rawData.mcpServers) {
      sourceIndex[item.name] = item;
    }
  }
  rebuildIndex(raw);

  // Rescan function
  function rescan() {
    const newRaw = scanner(claudeDir);
    data = categorize(newRaw);
    rebuildIndex(newRaw);
    broadcast({ type: 'assets:updated', count: data.length });
    return data;
  }

  // WebSocket connections
  const wsClients = new Set();

  function broadcast(message) {
    const payload = JSON.stringify(message);
    for (const ws of wsClients) {
      try { ws.send(payload); } catch { wsClients.delete(ws); }
    }
  }

  // Router
  const router = createRouter({
    getData: () => data,
    getSourceIndex: () => sourceIndex,
    getRaw: () => raw,
    rescan,
    claudeDir,
    projectRoot,
  });

  // HTTP server
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // API routes
    if (url.pathname.startsWith('/api/')) {
      return router(req, res, url);
    }

    // Serve UI (static files or template)
    if (!headless) {
      serveUI(req, res, url, data);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', mode: 'headless', assets: data.length }));
    }
  });

  // WebSocket upgrade
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') { socket.destroy(); return; }

    // Minimal WebSocket handshake (no deps)
    const crypto = require('crypto');
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-5AB4BD286B5E')
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    const ws = createWsWrapper(socket);
    wsClients.add(ws);

    socket.on('close', () => wsClients.delete(ws));
    socket.on('error', () => wsClients.delete(ws));

    // Handle incoming messages
    ws.onMessage((msg) => {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'scan:start') rescan();
      } catch { /* ignore */ }
    });
  });

  // File watcher
  const watcher = createWatcher(claudeDir, projectRoot, () => {
    rescan();
  });

  // Start listening
  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve(server);
    });
  });
}

/**
 * Serve UI - either React dist or fallback to template HTML
 */
function serveUI(req, res, url, data) {
  // Try React UI dist first
  const uiDist = path.join(__dirname, '..', 'ui', 'dist');
  if (fs.existsSync(uiDist)) {
    const filePath = path.join(uiDist, url.pathname === '/' ? 'index.html' : url.pathname);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      const mimeTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    // SPA fallback
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(path.join(uiDist, 'index.html')).pipe(res);
    return;
  }

  // Fallback: generate template HTML (current behavior)
  const { generateHtml } = require('./generator');
  const html = generateHtml(data, true);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

/**
 * Minimal WebSocket frame wrapper (no external deps)
 */
function createWsWrapper(socket) {
  let buffer = Buffer.alloc(0);

  const ws = {
    send(data) {
      const payload = Buffer.from(data);
      let frame;
      if (payload.length < 126) {
        frame = Buffer.alloc(2 + payload.length);
        frame[0] = 0x81; // text frame
        frame[1] = payload.length;
        payload.copy(frame, 2);
      } else if (payload.length < 65536) {
        frame = Buffer.alloc(4 + payload.length);
        frame[0] = 0x81;
        frame[1] = 126;
        frame.writeUInt16BE(payload.length, 2);
        payload.copy(frame, 4);
      } else {
        frame = Buffer.alloc(10 + payload.length);
        frame[0] = 0x81;
        frame[1] = 127;
        frame.writeBigUInt64BE(BigInt(payload.length), 2);
        payload.copy(frame, 10);
      }
      socket.write(frame);
    },
    onMessage(cb) {
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
          const masked = (buffer[1] & 0x80) !== 0;
          let payloadLen = buffer[1] & 0x7f;
          let offset = 2;

          if (payloadLen === 126) {
            if (buffer.length < 4) return;
            payloadLen = buffer.readUInt16BE(2);
            offset = 4;
          } else if (payloadLen === 127) {
            if (buffer.length < 10) return;
            payloadLen = Number(buffer.readBigUInt64BE(2));
            offset = 10;
          }

          const maskLen = masked ? 4 : 0;
          const totalLen = offset + maskLen + payloadLen;
          if (buffer.length < totalLen) return;

          const mask = masked ? buffer.slice(offset, offset + maskLen) : null;
          const payload = buffer.slice(offset + maskLen, totalLen);

          if (masked) {
            for (let i = 0; i < payload.length; i++) {
              payload[i] ^= mask[i % 4];
            }
          }

          const opcode = buffer[0] & 0x0f;
          buffer = buffer.slice(totalLen);

          if (opcode === 0x01) cb(payload.toString('utf-8')); // text
          if (opcode === 0x08) socket.end(); // close
          if (opcode === 0x09) { // ping → pong
            const pong = Buffer.alloc(2);
            pong[0] = 0x8a;
            pong[1] = 0;
            socket.write(pong);
          }
        }
      });
    }
  };
  return ws;
}

module.exports = { startServer };
