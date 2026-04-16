#!/usr/bin/env node

'use strict';

const path = require('path');
const fs = require('fs');

const VERSION = require('../package.json').version;
const HOME = process.env.HOME || process.env.USERPROFILE || '';

function parseArgs(args) {
  const opts = {
    command: null,     // null = agent mode, 'scan' = one-shot
    claudeDir: null,
    output: null,
    port: 3000,
    open: true,
    headless: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'scan') opts.command = 'scan';
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--version' || arg === '-v') opts.version = true;
    else if (arg === '--no-open') opts.open = false;
    else if (arg === '--headless') { opts.headless = true; opts.open = false; }
    else if (arg === '--dir' || arg === '-d') opts.claudeDir = args[++i];
    else if (arg === '--output' || arg === '-o') opts.output = args[++i];
    else if (arg === '--port' || arg === '-p') opts.port = parseInt(args[++i], 10) || 3000;
    // Legacy compat: -s <port> = agent mode with port
    else if (arg === '--serve' || arg === '-s') opts.port = parseInt(args[++i], 10) || 3000;
  }

  return opts;
}

function printHelp() {
  console.log(`
  harness-control-plane v${VERSION}

  Visual control plane for your AI coding harness.
  Auto-discovers skills, agents, MCP servers from Claude, Codex,
  Gemini, Cursor, Windsurf, Copilot, and Continue.

  Usage:
    hcp [options]              Start agent with web UI
    hcp scan [options]         One-shot scan (no server)

  Agent mode (default):
    hcp                        Start on port 3000, open browser
    hcp -p 8080                Custom port
    hcp --headless             API only, no UI (for VPS)
    hcp --no-open              Don't auto-open browser

  Scan mode:
    hcp scan                   Print summary to stdout
    hcp scan -o map.html       Generate static HTML file

  Common options:
    -d, --dir <path>           Path to .claude/ directory (default: ~/.claude/)
    -p, --port <port>          Server port (default: 3000)
    -o, --output <path>        Save HTML to file (scan mode)
    --headless                 API-only, no UI serving
    --no-open                  Don't auto-open browser
    -v, --version              Show version
    -h, --help                 Show this help

  Examples:
    hcp                        # Full UI on localhost:3000
    hcp --headless -p 3000     # API only (VPS, access remotely)
    hcp scan -o ecosystem.html # Static HTML file
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
    if (err && platform === 'linux') console.log(`\n  Open in your browser: ${url}\n`);
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.version) { console.log(VERSION); return; }
  if (opts.help) { printHelp(); return; }

  const claudeDir = opts.claudeDir
    ? path.resolve(opts.claudeDir)
    : path.join(HOME, '.claude');

  const hasClaudeDir = fs.existsSync(claudeDir);

  if (!hasClaudeDir && opts.command === 'scan') {
    console.error(`\n  No AI tooling configs found at ${claudeDir}`);
    console.error(`  Use --dir to specify a custom path.\n`);
    process.exit(1);
  }

  // === SCAN MODE (one-shot, backward compat) ===
  if (opts.command === 'scan') {
    const { scanner } = require('../agent/scanner');
    const { categorize } = require('../agent/categorizer');
    const raw = scanner(claudeDir);
    const data = categorize(raw);

    const instrCount = (raw.instructions || []).length;
    const rulesCount = (raw.rules || []).length;

    console.log(`\n  Scanning ${claudeDir}...`);
    console.log(`  Found: ${raw.skills.length} skills, ${raw.agents.length} agents, ${raw.mcpServers.length} MCP servers` +
      (instrCount ? `, ${instrCount} instructions` : '') +
      (rulesCount ? `, ${rulesCount} rules` : ''));

    if (opts.output) {
      const { generateHtml } = require('../agent/generator');
      const html = generateHtml(data, false);
      const outPath = path.resolve(opts.output);
      fs.writeFileSync(outPath, html, 'utf-8');
      console.log(`  Saved to ${outPath}`);
      if (opts.open) openBrowser(outPath);
    } else if (!opts.output) {
      // Print summary to stdout
      console.log(`\n  Categories:`);
      const cats = {};
      data.forEach(d => { cats[d.cat] = (cats[d.cat] || 0) + 1; });
      Object.entries(cats).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
        console.log(`    ${cat}: ${count}`);
      });
    }
    console.log('');
    return;
  }

  // === AGENT MODE (default) ===
  console.log(`\n  Harness Control Plane v${VERSION}`);

  if (!hasClaudeDir) {
    console.log(`  No AI tooling detected yet — starting with empty dashboard.`);
    console.log(`  Install Claude Code, Codex, Gemini CLI, Cursor, or Windsurf to see your ecosystem.\n`);
  } else {
    console.log(`  Scanning ${claudeDir}...`);
  }

  const { startServer } = require('../agent/server');
  const server = await startServer({
    port: opts.port,
    claudeDir,
    projectRoot: process.cwd(),
    headless: opts.headless,
  });

  const url = `http://localhost:${opts.port}`;
  console.log(`  Agent running at ${url}`);
  if (opts.headless) {
    console.log(`  Mode: headless (API only)`);
  }
  console.log(`  API: ${url}/api/assets`);
  console.log(`  WebSocket: ws://localhost:${opts.port}/ws`);
  console.log('');

  if (opts.open && !opts.headless) {
    openBrowser(url);
  }

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n  Shutting down...');
    server.close();
    process.exit(0);
  });
}

main().catch(err => {
  if (err.message && err.message.includes('better-sqlite3')) {
    console.error(`\n  Error: Native module 'better-sqlite3' failed to load.`);
    console.error(`  Fix: npm rebuild better-sqlite3`);
    console.error(`  Or install build tools: xcode-select --install (macOS) / apt install build-essential python3 (Linux)\n`);
  } else if (err.message && err.message.includes('ssh2')) {
    console.error(`\n  Error: Native module 'ssh2' failed to load.`);
    console.error(`  Fix: npm rebuild ssh2\n`);
  } else {
    console.error(`\n  Error: ${err.message}\n`);
  }
  process.exit(1);
});
