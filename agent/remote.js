'use strict';

const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const store = require('./store');

/**
 * Active SSH connections pool
 */
const pool = new Map(); // envId → { client, ready }

/**
 * Connect to a remote server via SSH
 */
function sshConnect(env) {
  return new Promise((resolve, reject) => {
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

/**
 * Scan remote server for AI assets
 */
async function scanRemote(env) {
  const client = await sshConnect(env);
  const home = await sshExec(client, 'echo $HOME');
  const remoteHome = home.trim();

  const assets = [];

  // 1. Claude skills (commands/)
  const commandsDir = `${remoteHome}/.claude/commands`;
  const skillFiles = await sshListMdFiles(client, commandsDir);
  for (const fp of skillFiles) {
    const baseName = path.basename(fp, '.md');
    if (['INDEX', 'README', 'EXAMPLES', 'QUICK-REFERENCE', 'CHANGELOG'].includes(baseName)) continue;

    const relDir = path.dirname(fp).replace(commandsDir, '').replace(/^\//, '');
    const name = relDir ? `${relDir.replace(/\//g, ':')}:${baseName}` : baseName;

    const content = await sshReadFile(client, fp);
    const desc = content ? extractDescription(content) : '';

    assets.push({
      name,
      desc,
      type: 'skill',
      filePath: fp,
      providers: ['claude', 'codex', 'gemini'],
    });
  }

  // 2. Claude agents
  const agentsDir = `${remoteHome}/.claude/agents`;
  const agentFiles = await sshListMdFiles(client, agentsDir);
  for (const fp of agentFiles) {
    const baseName = path.basename(fp, '.md');
    if (['INDEX', 'README'].includes(baseName)) continue;

    const content = await sshReadFile(client, fp);
    const desc = content ? extractDescription(content) : '';

    assets.push({
      name: baseName,
      desc,
      type: 'agent',
      filePath: fp,
      providers: ['claude'],
    });
  }

  // 3. MCP servers
  const mcpPaths = [
    `${remoteHome}/.claude/.mcp.json`,
    `${remoteHome}/.claude/mcp.json`,
  ];
  for (const mcpPath of mcpPaths) {
    const content = await sshReadFile(client, mcpPath);
    if (!content) continue;
    try {
      const raw = JSON.parse(content);
      const servers = raw.mcpServers || raw.servers || {};
      for (const [name, config] of Object.entries(servers)) {
        assets.push({
          name,
          desc: config.description || `MCP server: ${name}`,
          type: 'mcp',
          filePath: mcpPath,
          providers: ['claude'],
        });
      }
    } catch { /* skip */ }
  }

  // 4. Instructions
  const instrFiles = [
    { path: `${remoteHome}/.codex/instructions.md`, name: 'codex-instructions', providers: ['codex'] },
    { path: `${remoteHome}/.gemini/instructions.md`, name: 'gemini-instructions', providers: ['gemini'] },
  ];
  for (const instr of instrFiles) {
    const content = await sshReadFile(client, instr.path);
    if (content) {
      assets.push({
        name: instr.name,
        desc: extractFirstLine(content),
        type: 'instruction',
        filePath: instr.path,
        providers: instr.providers,
      });
    }
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
 * Diff local vs remote assets
 */
function diffAssets(localAssets, remoteAssets) {
  const localMap = new Map(localAssets.map(a => [`${a.type}:${a.name}`, a]));
  const remoteMap = new Map(remoteAssets.map(a => [`${a.type}:${a.name}`, a]));

  const onlyLocal = [];
  const onlyRemote = [];
  const both = [];

  for (const [key, asset] of localMap) {
    if (remoteMap.has(key)) {
      both.push({ local: asset, remote: remoteMap.get(key) });
    } else {
      onlyLocal.push(asset);
    }
  }

  for (const [key, asset] of remoteMap) {
    if (!localMap.has(key)) {
      onlyRemote.push(asset);
    }
  }

  return { onlyLocal, onlyRemote, both, localCount: localAssets.length, remoteCount: remoteAssets.length };
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

// ─── Helpers ────────────────────────────────────────

function extractDescription(content) {
  // Try YAML frontmatter description
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

module.exports = {
  sshConnect,
  sshExec,
  sshReadFile,
  scanRemote,
  testConnection,
  sshDisconnect,
  disconnectAll,
  diffAssets,
  scpPush,
  scpPull,
};
