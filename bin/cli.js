#!/usr/bin/env node

'use strict';

const path = require('path');
const fs = require('fs');
const { scanner } = require('../src/scanner');
const { categorize } = require('../src/categorizer');
const { generateHtml } = require('../src/generator');

const VERSION = require('../package.json').version;

// Cross-platform home directory
const HOME = process.env.HOME || process.env.USERPROFILE || '';

function parseArgs(args) {
  const opts = {
    claudeDir: null,
    output: null,
    serve: null,
    open: true,
    help: false,
    version: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--version' || arg === '-v') opts.version = true;
    else if (arg === '--no-open') opts.open = false;
    else if (arg === '--dir' || arg === '-d') opts.claudeDir = args[++i];
    else if (arg === '--output' || arg === '-o') opts.output = args[++i];
    else if (arg === '--serve' || arg === '-s') {
      opts.serve = parseInt(args[++i], 10) || 3000;
      opts.open = true;
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
  ai-ecosystem-map v${VERSION}

  Generates an interactive visual map of your AI coding ecosystem.
  Auto-discovers skills, agents, MCP servers, rules, and instructions
  from Claude, Codex, Gemini, Cursor, Windsurf, Copilot, and Continue.

  Usage:
    aem [options]
    ai-ecosystem-map [options]
    npx ai-ecosystem-map [options]

  Options:
    -d, --dir <path>     Path to .claude/ directory (default: ~/.claude/)
    -o, --output <path>  Save HTML to file (default: opens temp file)
    -s, --serve <port>   Start local server on port (default: 3000)
    --no-open            Don't auto-open browser
    -v, --version        Show version
    -h, --help           Show this help

  Examples:
    aem                          # Scan ~/.claude/, open in browser
    aem -d ./my-project/.claude  # Scan project-local config
    aem -o ecosystem.html        # Save to file
    aem -s 8080                  # Serve on localhost:8080 (VPS)
`);
}

function openBrowser(url) {
  const { exec } = require('child_process');
  const platform = process.platform;

  let cmd;
  if (platform === 'darwin') cmd = `open "${url}"`;
  else if (platform === 'win32') cmd = `start "" "${url}"`;
  else cmd = `xdg-open "${url}" 2>/dev/null || sensible-browser "${url}" 2>/dev/null || echo "Open ${url} in your browser"`;

  exec(cmd, (err) => {
    if (err && platform === 'linux') {
      console.log(`\n  Open in your browser: ${url}\n`);
    }
  });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.version) {
    console.log(VERSION);
    return;
  }

  if (opts.help) {
    printHelp();
    return;
  }

  // Resolve .claude/ directory
  const claudeDir = opts.claudeDir
    ? path.resolve(opts.claudeDir)
    : path.join(HOME, '.claude');

  if (!fs.existsSync(claudeDir)) {
    console.error(`\n  Error: .claude/ directory not found at ${claudeDir}`);
    console.error(`  Use --dir to specify a custom path.\n`);
    process.exit(1);
  }

  console.log(`\n  Scanning ${claudeDir}...`);

  // Scan
  const raw = scanner(claudeDir);

  const instrCount = (raw.instructions || []).length;
  const rulesCount = (raw.rules || []).length;
  console.log(`  Found: ${raw.skills.length} skills, ${raw.agents.length} agents, ${raw.mcpServers.length} MCP servers` +
    (instrCount ? `, ${instrCount} instructions` : '') +
    (rulesCount ? `, ${rulesCount} rules` : ''));

  // Categorize
  const data = categorize(raw);

  // Generate HTML (pass serve mode flag)
  const html = generateHtml(data, !!opts.serve);

  if (opts.serve) {
    // Serve mode — full featured with API
    const http = require('http');
    const { connect, disconnect, getConnections } = require('../src/connector');
    const projectRoot = process.cwd();

    // Build source index from raw scan (skills, agents, mcp, instructions, rules)
    const sourceIndex = {};
    for (const item of [...raw.skills, ...raw.agents, ...(raw.instructions || []), ...(raw.rules || [])]) {
      if (item.filePath) sourceIndex[item.name] = item;
    }
    for (const item of raw.mcpServers) {
      sourceIndex[item.name] = item;
    }

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${opts.serve}`);

      // CORS for local dev
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

      // API: Connect skill to tool
      if (url.pathname === '/api/connect' && req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const { name, tool, type } = JSON.parse(body);
            const source = sourceIndex[name];
            if (!source) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Item not found' }));
              return;
            }
            const result = connect(source.filePath, tool, type, name, projectRoot, source.raw);
            res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        });
        return;
      }

      // API: Disconnect
      if (url.pathname === '/api/disconnect' && req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const { name, tool, type } = JSON.parse(body);
            const result = disconnect(tool, type, name, projectRoot);
            res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        });
        return;
      }

      // API: Get connections for an item
      if (url.pathname === '/api/connections' && req.method === 'GET') {
        const name = url.searchParams.get('name');
        const type = url.searchParams.get('type');
        const source = sourceIndex[name];
        const connections = getConnections(
          source ? source.filePath : null, type, name, projectRoot
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(connections));
        return;
      }

      // API: Rescan
      if (url.pathname === '/api/rescan' && req.method === 'POST') {
        const newRaw = scanner(claudeDir);
        const newData = categorize(newRaw);
        // Update source index
        for (const item of [...newRaw.skills, ...newRaw.agents, ...(newRaw.instructions || []), ...(newRaw.rules || [])]) {
          if (item.filePath) sourceIndex[item.name] = item;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, data: newData, count: newData.length }));
        return;
      }

      // Default: serve HTML
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });

    server.listen(opts.serve, () => {
      const url = `http://localhost:${opts.serve}`;
      console.log(`  Serving at ${url}`);
      console.log(`  API enabled: connect, disconnect, rescan\n`);
      if (opts.open) openBrowser(url);
    });
  } else if (opts.output) {
    // File output
    const outPath = path.resolve(opts.output);
    fs.writeFileSync(outPath, html, 'utf-8');
    console.log(`  Saved to ${outPath}`);
    if (opts.open) openBrowser(outPath);
    console.log('');
  } else {
    // Temp file
    const os = require('os');
    const tmpFile = path.join(os.tmpdir(), `claude-ecosystem-${Date.now()}.html`);
    fs.writeFileSync(tmpFile, html, 'utf-8');
    console.log(`  Opening in browser...\n`);
    openBrowser(tmpFile);
  }
}

main();
