'use strict';

let Client;
try {
  Client = require('ssh2').Client;
} catch {
  Client = null;
}
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { evaluateAssetHealth } = require('./health');
const { diffAssets } = require('./diff');
const posix = path.posix;
const crypto = require('crypto');

const REMOTE_PROJECT_MARKERS = [
  '.claude',
  '.cursor',
  '.windsurf',
  '.github/copilot-instructions.md',
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  '.cursorrules',
  '.windsurfrules',
  '.mcp.json',
];

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function resolveRemotePath(remoteHome, targetPath) {
  if (!targetPath) return remoteHome;
  if (targetPath.startsWith('~/')) return posix.join(remoteHome, targetPath.slice(2));
  if (targetPath === '~') return remoteHome;
  return targetPath;
}

function stableRemoteProjectAssetId(environmentId, projectPath, type, name, filePath = '') {
  return crypto
    .createHash('sha1')
    .update(`${environmentId}:${projectPath}:${type}:${name}:${filePath}`)
    .digest('hex')
    .slice(0, 12);
}

/**
 * Active SSH connections pool
 */
const pool = new Map(); // envId → { client, ready }

/**
 * Connect to a remote server via SSH
 */
function sshConnect(env) {
  return new Promise((resolve, reject) => {
    if (!Client) {
      return reject(new Error('SSH not available: ssh2 module failed to load. Run "npm rebuild ssh2".'));
    }

    if (pool.has(env.id) && pool.get(env.id).ready) {
      return resolve(pool.get(env.id).client);
    }

    const client = new Client();
    const config = {
      host: env.ssh_host,
      port: env.ssh_port || 22,
      username: env.ssh_user,
    };

    // Key-based auth
    if (env.ssh_key_path) {
      try {
        config.privateKey = fs.readFileSync(
          env.ssh_key_path.replace('~', process.env.HOME || '')
        );
      } catch (err) {
        return reject(new Error(`Cannot read SSH key: ${env.ssh_key_path}`));
      }
    } else {
      // Try default keys
      const defaultKeys = ['~/.ssh/id_ed25519', '~/.ssh/id_rsa'];
      const HOME = process.env.HOME || '';
      for (const k of defaultKeys) {
        const kp = k.replace('~', HOME);
        if (fs.existsSync(kp)) {
          config.privateKey = fs.readFileSync(kp);
          break;
        }
      }
    }

    client.on('ready', () => {
      pool.set(env.id, { client, ready: true });
      resolve(client);
    });

    client.on('error', (err) => {
      pool.delete(env.id);
      reject(err);
    });

    client.on('close', () => {
      pool.delete(env.id);
    });

    client.connect(config);
  });
}

/**
 * Execute a command via SSH, return stdout
 */
function sshExec(client, cmd) {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('data', (d) => { stdout += d; });
      stream.stderr.on('data', (d) => { stderr += d; });
      stream.on('close', (code) => {
        if (code !== 0 && !stdout) return reject(new Error(stderr || `Exit code ${code}`));
        resolve(stdout);
      });
    });
  });
}

/**
 * Read a file from remote via SSH
 */
async function sshReadFile(client, remotePath) {
  try {
    return await sshExec(client, `cat "${remotePath}" 2>/dev/null`);
  } catch {
    return null;
  }
}

/**
 * Write a file to remote via SFTP
 */
function sshWriteFile(client, remotePath, content) {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);

      const remoteDir = posix.dirname(remotePath);
      client.exec(`mkdir -p "${remoteDir}"`, (dirErr, stream) => {
        if (dirErr) return reject(dirErr);
        stream.on('close', () => {
          const writeStream = sftp.createWriteStream(remotePath, { encoding: 'utf8' });
          writeStream.on('close', () => resolve());
          writeStream.on('error', reject);
          writeStream.end(content);
        });
        stream.stderr.on('data', (stderr) => reject(new Error(stderr.toString())));
      });
    });
  });
}

/**
 * Check if remote path exists
 */
async function sshExists(client, remotePath) {
  try {
    await sshExec(client, `test -e "${remotePath}" && echo yes`);
    return true;
  } catch {
    return false;
  }
}

/**
 * List .md files in a remote directory
 */
async function sshListMdFiles(client, dir) {
  try {
    const output = await sshExec(client, `find "${dir}" -name "*.md" -type f 2>/dev/null`);
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function extractDescription(content) {
  const match = content.match(/^---\s*\n[\s\S]*?description:\s*["']?([^"'\n]+)["']?/m);
  if (match) return match[1].trim().substring(0, 200);
  return extractFirstLine(content);
}

function extractFirstLine(content) {
  let inFrontmatter = false;
  for (const line of content.split('\n')) {
    if (line.trim() === '---') { inFrontmatter = !inFrontmatter; continue; }
    if (inFrontmatter) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    return trimmed.substring(0, 200);
  }
  return '';
}

async function scanMarkdownDirectory(client, rootDir, type, providers, options = {}) {
  const assets = [];
  const files = await sshListMdFiles(client, rootDir);
  const skipBaseNames = new Set(options.skipBaseNames || []);

  for (const fp of files) {
    const rel = posix.relative(rootDir, fp);
    if (!rel || rel.startsWith('..')) continue;
    if (rel.split('/').some((segment) => segment.startsWith('.') || segment.startsWith('_'))) continue;

    const baseName = posix.basename(fp, '.md');
    if (skipBaseNames.has(baseName)) continue;

    const content = await sshReadFile(client, fp);
    const desc = content ? extractDescription(content) : '';
    const name = rel.replace(/\.md$/i, '').split('/').join(':');

    assets.push({
      name,
      desc,
      type,
      filePath: fp,
      providers: [...providers],
    });
  }

  return assets.map((asset) => ({
    ...asset,
    health: evaluateAssetHealth(asset, { isLocalEnvironment: false }),
  }));
}

async function listRemoteDirectories(client, dir) {
  try {
    const output = await sshExec(
      client,
      `find ${shellQuote(dir)} -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null`
    );
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function remotePathExists(client, targetPath) {
  try {
    await sshExec(client, `test -e ${shellQuote(targetPath)} && echo yes`);
    return true;
  } catch {
    return false;
  }
}

async function detectRemoteProjectProviders(client, projectPath) {
  const providers = new Set();
  const checks = [
    { paths: ['.claude', 'CLAUDE.md'], provider: 'claude' },
    { paths: ['AGENTS.md'], provider: 'codex' },
    { paths: ['GEMINI.md'], provider: 'gemini' },
    { paths: ['.cursor', '.cursorrules'], provider: 'cursor' },
    { paths: ['.windsurf', '.windsurfrules'], provider: 'windsurf' },
    { paths: ['.github/copilot-instructions.md'], provider: 'copilot' },
  ];

  for (const entry of checks) {
    for (const markerPath of entry.paths) {
      if (await remotePathExists(client, posix.join(projectPath, markerPath))) {
        providers.add(entry.provider);
        break;
      }
    }
  }

  return [...providers];
}

async function hasRemoteProjectMarker(client, projectPath) {
  for (const marker of REMOTE_PROJECT_MARKERS) {
    if (await remotePathExists(client, posix.join(projectPath, marker))) return true;
  }
  return false;
}

async function scanRemoteProjectAssets(env, projectPath) {
  const client = await sshConnect(env);
  const assets = [];
  const projectName = posix.basename(projectPath);

  function pushAsset(asset) {
    const normalized = {
      id: stableRemoteProjectAssetId(env.id, projectPath, asset.type, asset.name, asset.filePath || ''),
      environment_id: env.id,
      environment_type: 'remote',
      scope: 'project',
      projectPath,
      projectName,
      ...asset,
    };
    assets.push({
      ...normalized,
      health: evaluateAssetHealth(normalized, { isLocalEnvironment: false }),
    });
  }

  const markdownSources = [
    { dir: `${projectPath}/.claude/commands`, type: 'skill', providers: ['claude', 'codex', 'gemini'], skipBaseNames: ['INDEX', 'README', 'EXAMPLES', 'QUICK-REFERENCE', 'CHANGELOG'] },
    { dir: `${projectPath}/.claude/agents`, type: 'agent', providers: ['claude'], skipBaseNames: ['INDEX', 'README'] },
    { dir: `${projectPath}/.claude/rules`, type: 'rule', providers: ['claude'], skipBaseNames: ['INDEX', 'README'] },
    { dir: `${projectPath}/.cursor/rules`, type: 'rule', providers: ['cursor'], skipBaseNames: ['INDEX', 'README'] },
    { dir: `${projectPath}/.windsurf/rules`, type: 'rule', providers: ['windsurf'], skipBaseNames: ['INDEX', 'README'] },
  ];

  for (const entry of markdownSources) {
    const found = await scanMarkdownDirectory(client, entry.dir, entry.type, entry.providers, {
      skipBaseNames: entry.skipBaseNames,
    });
    for (const asset of found) pushAsset(asset);
  }

  const localMcp = `${projectPath}/.mcp.json`;
  const mcpContent = await sshReadFile(client, localMcp);
  if (mcpContent) {
    try {
      const raw = JSON.parse(mcpContent);
      const servers = raw.mcpServers || raw.servers || {};
      for (const [name, config] of Object.entries(servers)) {
        pushAsset({
          name,
          desc: config.description || `MCP server: ${name}`,
          type: 'mcp',
          filePath: localMcp,
          rawConfig: config,
          providers: ['claude', 'cursor'],
          locations: {
            claude: localMcp,
            cursor: localMcp,
          },
        });
      }
    } catch {
      // Skip malformed project-level MCP configs.
    }
  }

  const instructionFiles = [
    { file: 'CLAUDE.md', providers: ['claude'] },
    { file: 'AGENTS.md', providers: ['codex', 'copilot', 'cursor', 'windsurf'] },
    { file: 'GEMINI.md', providers: ['gemini'] },
    { file: '.cursorrules', providers: ['cursor'] },
    { file: '.windsurfrules', providers: ['windsurf'] },
    { file: '.github/copilot-instructions.md', providers: ['copilot'] },
  ];

  for (const instruction of instructionFiles) {
    const fullPath = posix.join(projectPath, instruction.file);
    const content = await sshReadFile(client, fullPath);
    if (!content) continue;
    pushAsset({
      name: instruction.file.replace(/^\./, '').replace(/\.md$/, '').toLowerCase(),
      desc: extractFirstLine(content) || `${instruction.file} instructions`,
      type: 'instruction',
      filePath: fullPath,
      providers: [...instruction.providers],
    });
  }

  return assets;
}

async function discoverRemoteProjects(env, searchDirs = []) {
  const client = await sshConnect(env);
  const remoteHome = (await sshExec(client, 'echo $HOME')).trim();
  const baseDirs = (searchDirs.length ? searchDirs : ['~/Projects', '~/Documents/Projects']).map((entry) => resolveRemotePath(remoteHome, entry));
  const projects = [];
  const seen = new Set();

  for (const dir of baseDirs) {
    const childDirs = await listRemoteDirectories(client, dir);
    for (const projectPath of childDirs) {
      if (seen.has(projectPath)) continue;
      if (!(await hasRemoteProjectMarker(client, projectPath))) continue;

      const providers = await detectRemoteProjectProviders(client, projectPath);
      const assets = await scanRemoteProjectAssets(env, projectPath);
      seen.add(projectPath);
      projects.push({
        path: projectPath,
        name: posix.basename(projectPath),
        providers,
        assetCount: assets.length,
        assets,
        environment_id: env.id,
        environment_type: 'remote',
        environment_name: env.name,
      });
    }
  }

  return projects;
}

function mergeRemoteMcpAsset(assets, name, config, providers, mcpPath) {
  const existing = assets.find((asset) => asset.type === 'mcp' && asset.name === name);
  if (existing) {
    existing.providers = [...new Set([...(existing.providers || []), ...providers])];
    existing.locations = { ...(existing.locations || {}), ...Object.fromEntries(providers.map((provider) => [provider, mcpPath])) };
    if (!existing.filePath) existing.filePath = mcpPath;
    if (!existing.rawConfig) existing.rawConfig = config;
    return;
  }

  assets.push({
    name,
    desc: config.description || `MCP server: ${name}`,
    type: 'mcp',
    filePath: mcpPath,
    rawConfig: config,
    providers: [...providers],
    locations: Object.fromEntries(providers.map((provider) => [provider, mcpPath])),
  });
}

/**
 * Scan remote server for AI assets
 */
async function scanRemote(env) {
  const client = await sshConnect(env);
  const home = await sshExec(client, 'echo $HOME');
  const remoteHome = home.trim();

  const assets = [];

  assets.push(...await scanMarkdownDirectory(client, `${remoteHome}/.claude/commands`, 'skill', ['claude', 'codex', 'gemini'], {
    skipBaseNames: ['INDEX', 'README', 'EXAMPLES', 'QUICK-REFERENCE', 'CHANGELOG'],
  }));
  assets.push(...await scanMarkdownDirectory(client, `${remoteHome}/.codex/skills/public`, 'skill', ['codex'], {
    skipBaseNames: ['INDEX', 'README', 'EXAMPLES', 'QUICK-REFERENCE', 'CHANGELOG'],
  }));
  assets.push(...await scanMarkdownDirectory(client, `${remoteHome}/.gemini/skills`, 'skill', ['gemini'], {
    skipBaseNames: ['INDEX', 'README', 'EXAMPLES', 'QUICK-REFERENCE', 'CHANGELOG'],
  }));

  assets.push(...await scanMarkdownDirectory(client, `${remoteHome}/.claude/agents`, 'agent', ['claude'], {
    skipBaseNames: ['INDEX', 'README'],
  }));
  assets.push(...await scanMarkdownDirectory(client, `${remoteHome}/.codex/agents`, 'agent', ['codex'], {
    skipBaseNames: ['INDEX', 'README'],
  }));

  assets.push(...await scanMarkdownDirectory(client, `${remoteHome}/.claude/rules`, 'rule', ['claude'], {
    skipBaseNames: ['INDEX', 'README'],
  }));
  assets.push(...await scanMarkdownDirectory(client, `${remoteHome}/.cursor/rules`, 'rule', ['cursor'], {
    skipBaseNames: ['INDEX', 'README'],
  }));
  assets.push(...await scanMarkdownDirectory(client, `${remoteHome}/.windsurf/rules`, 'rule', ['windsurf'], {
    skipBaseNames: ['INDEX', 'README'],
  }));

  const instructionFiles = [
    { path: `${remoteHome}/CLAUDE.md`, providers: ['claude'], name: 'CLAUDE.md' },
    { path: `${remoteHome}/AGENTS.md`, providers: ['codex', 'copilot', 'cursor', 'windsurf'], name: 'AGENTS.md' },
    { path: `${remoteHome}/GEMINI.md`, providers: ['gemini'], name: 'GEMINI.md' },
    { path: `${remoteHome}/.cursorrules`, providers: ['cursor'], name: '.cursorrules' },
    { path: `${remoteHome}/.windsurfrules`, providers: ['windsurf'], name: '.windsurfrules' },
    { path: `${remoteHome}/.github/copilot-instructions.md`, providers: ['copilot'], name: 'copilot-instructions' },
    { path: `${remoteHome}/.claude/CLAUDE.md`, providers: ['claude'], name: 'claude' },
    { path: `${remoteHome}/.codex/instructions.md`, providers: ['codex'], name: 'codex-instructions' },
    { path: `${remoteHome}/.gemini/instructions.md`, providers: ['gemini'], name: 'gemini-instructions' },
    { path: `${remoteHome}/.gemini/GEMINI.md`, providers: ['gemini'], name: 'gemini-gemini' },
  ];

  for (const instruction of instructionFiles) {
    const content = await sshReadFile(client, instruction.path);
    if (!content) continue;
    assets.push({
      name: instruction.name,
      desc: extractFirstLine(content) || `Instructions: ${instruction.name}`,
      type: 'instruction',
      filePath: instruction.path,
      providers: [...instruction.providers],
    });
  }

  const continueConfigPath = `${remoteHome}/.continue/config.json`;
  if (await sshExists(client, continueConfigPath)) {
    assets.push({
      name: 'continue-config',
      desc: 'Continue.dev configuration',
      type: 'instruction',
      filePath: continueConfigPath,
      providers: ['continue_dev'],
    });
  }

  const mcpPaths = [
    { path: `${remoteHome}/.claude/.mcp.json`, providers: ['claude'] },
    { path: `${remoteHome}/.claude/mcp.json`, providers: ['claude'] },
    { path: `${remoteHome}/.codex/mcp.json`, providers: ['codex'] },
    { path: `${remoteHome}/.gemini/mcp.json`, providers: ['gemini'] },
    { path: `${remoteHome}/.windsurf/mcp.json`, providers: ['windsurf'] },
    { path: continueConfigPath, providers: ['continue_dev'] },
  ];
  for (const { path: mcpPath, providers } of mcpPaths) {
    const content = await sshReadFile(client, mcpPath);
    if (!content) continue;
    try {
      const raw = JSON.parse(content);
      const key = providers.includes('continue_dev') ? 'servers' : (raw.mcpServers ? 'mcpServers' : 'servers');
      const servers = raw[key] || {};
      for (const [name, config] of Object.entries(servers)) {
        mergeRemoteMcpAsset(assets, name, config, providers, mcpPath);
      }
    } catch { /* skip */ }
  }

  return assets;
}

/**
 * Test SSH connection to environment
 */
async function testConnection(env) {
  try {
    const client = await sshConnect(env);
    const hostname = await sshExec(client, 'hostname');
    return { ok: true, hostname: hostname.trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Disconnect from a remote server
 */
function sshDisconnect(envId) {
  const entry = pool.get(envId);
  if (entry) {
    entry.client.end();
    pool.delete(envId);
  }
}

/**
 * Disconnect all
 */
function disconnectAll() {
  for (const [id, entry] of pool) {
    entry.client.end();
    pool.delete(id);
  }
}

/**
 * Push a file to remote via SCP
 */
function scpPush(client, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);

      // Ensure remote directory exists
      const remoteDir = path.dirname(remotePath);
      client.exec(`mkdir -p "${remoteDir}"`, (err2) => {
        if (err2) return reject(err2);

        const readStream = fs.createReadStream(localPath);
        const writeStream = sftp.createWriteStream(remotePath);

        writeStream.on('close', () => resolve());
        writeStream.on('error', reject);
        readStream.pipe(writeStream);
      });
    });
  });
}

/**
 * Pull a file from remote via SCP
 */
function scpPull(client, remotePath, localPath) {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);

      const localDir = path.dirname(localPath);
      if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });

      const readStream = sftp.createReadStream(remotePath);
      const writeStream = fs.createWriteStream(localPath);

      writeStream.on('close', () => resolve());
      writeStream.on('error', reject);
      readStream.on('error', reject);
      readStream.pipe(writeStream);
    });
  });
}

function sshDeleteFile(client, remotePath) {
  return sshExec(client, `rm -f "${remotePath}"`).then(() => undefined);
}

module.exports = {
  sshConnect,
  sshExec,
  sshReadFile,
  sshWriteFile,
  sshExists,
  sshDeleteFile,
  scanRemote,
  discoverRemoteProjects,
  scanRemoteProjectAssets,
  testConnection,
  sshDisconnect,
  disconnectAll,
  diffAssets,
  scpPush,
  scpPull,
};
