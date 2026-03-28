'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const HOME = process.env.HOME || '';

/**
 * Get MCP server config from .mcp.json files
 */
function getMcpConfig(serverName, claudeDir, projectRoot) {
  const searchPaths = [
    path.join(claudeDir, '.mcp.json'),
    path.join(claudeDir, 'mcp.json'),
    path.join(projectRoot, '.mcp.json'),
    path.join(projectRoot, 'mcp.json'),
  ];

  for (const mcpPath of searchPaths) {
    if (!fs.existsSync(mcpPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
      const servers = raw.mcpServers || raw.servers || {};
      if (servers[serverName]) {
        return { config: servers[serverName], source: mcpPath };
      }
    } catch { /* skip */ }
  }
  return null;
}

/**
 * Connect to a stdio MCP server and list its tools.
 * Spawns the process, sends initialize + tools/list, returns tools.
 */
function listMcpTools(config, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const command = config.command;
    const args = config.args || [];
    const env = { ...process.env, ...(config.env || {}) };

    if (!command) return reject(new Error('No command in MCP config'));

    let proc;
    try {
      proc = spawn(command, args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
    } catch (err) {
      return reject(new Error(`Cannot spawn "${command}": ${err.message}`));
    }

    let stdout = '';
    let stderr = '';
    let finished = false;
    const tools = [];
    let phase = 'init'; // init → initialized → tools

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        proc.kill();
        if (tools.length > 0) {
          resolve(tools);
        } else {
          reject(new Error('Timeout waiting for MCP server response'));
        }
      }
    }, timeout);

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      // Parse JSON-RPC messages (newline-delimited)
      const lines = stdout.split('\n');
      stdout = lines.pop() || ''; // keep incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);

          if (phase === 'init' && msg.id === 1 && msg.result) {
            // Initialize response received — send initialized notification + tools/list
            phase = 'initialized';
            const initialized = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n';
            const toolsList = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n';
            proc.stdin.write(initialized);
            proc.stdin.write(toolsList);
          }

          if (msg.id === 2 && msg.result && msg.result.tools) {
            // Tools list received
            for (const tool of msg.result.tools) {
              tools.push({
                name: tool.name,
                description: tool.description || '',
                parameters: tool.inputSchema || null,
              });
            }
            finished = true;
            clearTimeout(timer);
            proc.kill();
            resolve(tools);
          }

          if (msg.error) {
            finished = true;
            clearTimeout(timer);
            proc.kill();
            reject(new Error(msg.error.message || 'MCP error'));
          }
        } catch { /* not JSON, skip */ }
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(new Error(`Process error: ${err.message}`));
      }
    });

    proc.on('close', (code) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        if (tools.length > 0) {
          resolve(tools);
        } else {
          reject(new Error(`MCP server exited (code ${code})${stderr ? ': ' + stderr.substring(0, 200) : ''}`));
        }
      }
    });

    // Send initialize request
    const initMsg = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'ai-ecosystem-map', version: '1.0.0' },
      },
    }) + '\n';

    proc.stdin.write(initMsg);
  });
}

/**
 * Connect to an HTTP MCP server (or agent) and list tools
 */
function listHttpTools(url, timeout = 10000) {
  const https = url.startsWith('https') ? require('https') : require('http');

  return new Promise((resolve, reject) => {
    // First: initialize
    const initBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'ai-ecosystem-map', version: '1.0.0' },
      },
    });

    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout,
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const initResult = JSON.parse(body);
          if (initResult.error) return reject(new Error(initResult.error.message));

          // Now request tools/list
          const toolsBody = JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {},
          });

          const req2 = https.request(options, (res2) => {
            let body2 = '';
            res2.on('data', c => body2 += c);
            res2.on('end', () => {
              try {
                const toolsResult = JSON.parse(body2);
                if (toolsResult.result && toolsResult.result.tools) {
                  resolve(toolsResult.result.tools.map(t => ({
                    name: t.name,
                    description: t.description || '',
                    parameters: t.inputSchema || null,
                  })));
                } else {
                  reject(new Error('No tools in response'));
                }
              } catch (e) { reject(e); }
            });
          });
          req2.on('error', reject);
          req2.on('timeout', () => reject(new Error('Timeout')));
          req2.write(toolsBody);
          req2.end();
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Timeout connecting to MCP server')));
    req.write(initBody);
    req.end();
  });
}

module.exports = { getMcpConfig, listMcpTools, listHttpTools };
