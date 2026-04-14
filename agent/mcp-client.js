'use strict';

const { spawn } = require('child_process');
const fs = require('fs');

const DEFAULT_PROTOCOL_VERSION = '2024-11-05';

function getMcpConfig(serverName, claudeDir, projectRoot) {
  const path = require('path');
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
    } catch {
      // Ignore malformed config files while searching for a match.
    }
  }
  return null;
}

function inferTransport(config = {}) {
  if (!config || typeof config !== 'object') return 'unknown';
  if (config.command) return 'stdio';
  if (config.type === 'sse') return 'sse';
  if (config.url || config.port) return 'http';
  return 'unknown';
}

function finalizeResult(result) {
  return {
    transport: result.transport || 'unknown',
    status: result.status || 'broken',
    reachable: Boolean(result.reachable),
    phase: result.phase || 'runtime',
    reasonCode: result.reasonCode || 'runtime_error',
    summary: result.summary || 'MCP runtime check failed.',
    details: Array.isArray(result.details) ? result.details : [],
    checkedAt: result.checkedAt || new Date().toISOString(),
    durationMs: typeof result.durationMs === 'number' ? result.durationMs : null,
    toolCount: typeof result.toolCount === 'number' ? result.toolCount : null,
    tools: Array.isArray(result.tools) ? result.tools : [],
    cached: Boolean(result.cached),
    stale: Boolean(result.stale),
  };
}

function buildJsonRpcFrame(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8'),
    body,
  ]);
}

function normalizeHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key, value]) => key && value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  );
}

function inferHttpUrl(config) {
  if (typeof config?.url === 'string' && config.url.trim()) return config.url;
  if (config?.port) return `http://localhost:${config.port}`;
  return null;
}

function sanitizeTool(tool) {
  return {
    name: tool.name,
    description: tool.description || '',
    parameters: tool.inputSchema || null,
  };
}

function createJsonRpcParser() {
  let buffer = Buffer.alloc(0);

  return {
    push(chunk) {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      const events = [];

      while (buffer.length > 0) {
        const text = buffer.toString('utf8');
        const headerEnd = text.indexOf('\r\n\r\n');

        if (headerEnd > -1 && /^Content-Length:/i.test(text.slice(0, headerEnd))) {
          const header = text.slice(0, headerEnd);
          const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
          if (!lengthMatch) {
            events.push({ type: 'noise', value: header.trim() });
            buffer = Buffer.from(text.slice(headerEnd + 4), 'utf8');
            continue;
          }

          const length = Number(lengthMatch[1]);
          const totalBytes = Buffer.byteLength(text.slice(0, headerEnd + 4), 'utf8') + length;
          if (buffer.length < totalBytes) break;

          const bodyStart = headerEnd + 4;
          const bodyBuffer = buffer.slice(bodyStart, bodyStart + length);
          buffer = buffer.slice(bodyStart + length);

          try {
            events.push({ type: 'message', value: JSON.parse(bodyBuffer.toString('utf8')) });
          } catch (err) {
            events.push({ type: 'parse_error', value: err.message });
          }
          continue;
        }

        const newlineIndex = text.indexOf('\n');
        if (newlineIndex === -1) break;

        const line = text.slice(0, newlineIndex).trim();
        buffer = Buffer.from(text.slice(newlineIndex + 1), 'utf8');
        if (!line) continue;

        try {
          events.push({ type: 'message', value: JSON.parse(line) });
        } catch {
          events.push({ type: 'noise', value: line });
        }
      }

      return events;
    },
  };
}

function classifyRuntimeFailure(message, { transport = 'unknown', phase = 'runtime', statusCode = null } = {}) {
  const text = String(message || '').toLowerCase();

  if (statusCode === 401 || statusCode === 403 || /\bunauthoriz|forbidden|access token|api key|bearer|auth/.test(text)) {
    return {
      reasonCode: 'auth',
      summary: 'MCP runtime check failed because authentication is missing or invalid.',
    };
  }

  if (statusCode === 404 || statusCode === 405 || statusCode === 406 || statusCode === 415 || /\bprotocol\b|\bcontent-length\b|\bjson-rpc\b|\binitialize\b|\btools\/list\b|\bno tools\b/.test(text)) {
    return {
      reasonCode: 'protocol_mismatch',
      summary: transport === 'sse'
        ? 'The endpoint responded, but the MCP transport or handshake does not match what the checker can use.'
        : 'The MCP transport responded with a protocol mismatch during handshake or tools listing.',
    };
  }

  if (/\btimeout\b|timed out|etimedout|aborted/.test(text)) {
    return {
      reasonCode: 'timeout',
      summary: `The MCP runtime check timed out during ${phase}.`,
    };
  }

  if (/\benoent\b|not found|cannot spawn/.test(text)) {
    return {
      reasonCode: 'missing_binary',
      summary: 'The MCP runtime binary could not be found on disk.',
    };
  }

  if (/\beconnrefused\b|connection refused/.test(text)) {
    return {
      reasonCode: 'connection_refused',
      summary: 'The MCP endpoint refused the connection.',
    };
  }

  if (/\benotfound\b|getaddrinfo|dns/.test(text)) {
    return {
      reasonCode: 'dns',
      summary: 'The MCP endpoint host could not be resolved.',
    };
  }

  if (/\bpermission denied\b|eacces\b/.test(text)) {
    return {
      reasonCode: 'permission_denied',
      summary: 'The MCP runtime binary exists, but it cannot be executed because of permissions.',
    };
  }

  if (/\bexited\b|exit code/.test(text)) {
    return {
      reasonCode: 'process_exit',
      summary: 'The MCP runtime process exited before completing the handshake.',
    };
  }

  return {
    reasonCode: 'runtime_error',
    summary: 'The MCP runtime check failed with an unexpected error.',
  };
}

function requestJson(urlString, { method = 'POST', headers = {}, body = null, timeoutMs = 10000 } = {}) {
  const url = new URL(urlString);
  const client = url.protocol === 'https:' ? require('https') : require('http');

  return new Promise((resolve, reject) => {
    const req = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers,
    }, (res) => {
      let payload = '';
      res.on('data', (chunk) => { payload += chunk.toString(); });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers || {},
          body: payload,
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Timeout'));
    });

    if (body != null) req.write(body);
    req.end();
  });
}

async function inspectSseReachability(url, headers, timeoutMs) {
  const response = await requestJson(url, {
    method: 'GET',
    headers: {
      Accept: 'text/event-stream',
      ...headers,
    },
    timeoutMs,
  });

  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  if (response.statusCode === 401 || response.statusCode === 403) {
    const failure = classifyRuntimeFailure(`HTTP ${response.statusCode}`, { transport: 'sse', statusCode: response.statusCode });
    return finalizeResult({
      transport: 'sse',
      status: 'broken',
      reachable: false,
      phase: 'connect',
      reasonCode: failure.reasonCode,
      summary: failure.summary,
      details: ['The SSE endpoint rejected the request before the MCP session could start.'],
      tools: [],
      toolCount: null,
    });
  }

  if (response.statusCode >= 200 && response.statusCode < 300 && contentType.includes('text/event-stream')) {
    return finalizeResult({
      transport: 'sse',
      status: 'warning',
      reachable: true,
      phase: 'connect',
      reasonCode: 'sse_partial_support',
      summary: 'The SSE endpoint is reachable, but this checker cannot complete a full MCP tools listing over SSE yet.',
      details: ['The endpoint accepted an SSE connection.', 'A full MCP tools/list round-trip over SSE is not implemented in this checker.'],
      tools: [],
      toolCount: null,
    });
  }

  const failure = classifyRuntimeFailure(`HTTP ${response.statusCode} ${response.body || ''}`, {
    transport: 'sse',
    statusCode: response.statusCode,
  });

  return finalizeResult({
    transport: 'sse',
    status: 'broken',
    reachable: false,
    phase: 'connect',
    reasonCode: failure.reasonCode,
    summary: failure.summary,
    details: [`SSE probe returned HTTP ${response.statusCode}.`],
    tools: [],
    toolCount: null,
  });
}

function inspectStdioRuntime(config, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const command = config.command;
    const args = Array.isArray(config.args) ? config.args : [];
    const env = { ...process.env, ...(config.env || {}) };

    if (!command) {
      return resolve(finalizeResult({
        transport: 'stdio',
        status: 'broken',
        reachable: false,
        phase: 'config',
        reasonCode: 'missing_transport',
        summary: 'MCP config does not define a command for stdio transport.',
        details: ['Add a "command" field to the MCP server config.'],
      }));
    }

    let proc;
    try {
      proc = spawn(command, args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
    } catch (err) {
      const failure = classifyRuntimeFailure(err.message, { transport: 'stdio', phase: 'spawn' });
      return resolve(finalizeResult({
        transport: 'stdio',
        status: 'broken',
        reachable: false,
        phase: 'spawn',
        reasonCode: failure.reasonCode,
        summary: failure.summary,
        details: [err.message],
        durationMs: Date.now() - startedAt,
      }));
    }

    const parser = createJsonRpcParser();
    let stderr = '';
    let phase = 'spawn';
    let settled = false;
    let protocolNoise = false;

    const complete = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.kill(); } catch {}
      resolve(finalizeResult({
        durationMs: Date.now() - startedAt,
        ...result,
      }));
    };

    const sendMessage = (message) => {
      proc.stdin.write(buildJsonRpcFrame(message));
    };

    const handleFailure = (message) => {
      const failure = classifyRuntimeFailure(message, { transport: 'stdio', phase });
      complete({
        transport: 'stdio',
        status: 'broken',
        reachable: phase !== 'spawn',
        phase,
        reasonCode: failure.reasonCode,
        summary: failure.summary,
        details: [message].filter(Boolean),
        tools: [],
        toolCount: null,
      });
    };

    const timer = setTimeout(() => {
      handleFailure(`Timeout waiting for MCP response during ${phase}.`);
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      const events = parser.push(chunk);
      for (const event of events) {
        if (settled) return;

        if (event.type === 'noise') {
          protocolNoise = true;
          continue;
        }

        if (event.type === 'parse_error') {
          protocolNoise = true;
          continue;
        }

        const msg = event.value;
        if (msg?.error) {
          handleFailure(msg.error.message || 'MCP server returned an error.');
          return;
        }

        if (msg?.id === 1 && msg?.result) {
          phase = 'initialize';
          sendMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
          phase = 'tools_list';
          sendMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
          continue;
        }

        if (msg?.id === 2 && msg?.result) {
          const tools = Array.isArray(msg.result.tools) ? msg.result.tools.map(sanitizeTool) : [];
          complete({
            transport: 'stdio',
            status: 'ok',
            reachable: true,
            phase: 'complete',
            reasonCode: 'ok',
            summary: tools.length > 0
              ? `Runtime check succeeded and listed ${tools.length} tool${tools.length === 1 ? '' : 's'}.`
              : 'Runtime check succeeded. The MCP server is reachable but exposes no tools.',
            details: [
              'Initialize handshake completed successfully.',
              `tools/list returned ${tools.length} tool${tools.length === 1 ? '' : 's'}.`,
            ],
            tools,
            toolCount: tools.length,
          });
          return;
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      handleFailure(err.message);
    });

    proc.on('close', (code) => {
      if (settled) return;
      const details = [];
      if (stderr.trim()) details.push(stderr.trim().split('\n')[0]);
      if (protocolNoise) details.push('The process wrote output that does not look like MCP JSON-RPC frames.');
      handleFailure(details.join(' ') || `MCP server exited with code ${code}.`);
    });

    phase = 'initialize';
    sendMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'ai-ecosystem-map', version: '1.0.0' },
      },
    });
  });
}

async function inspectHttpRuntime(config, timeoutMs) {
  const transport = config.type === 'sse' ? 'sse' : 'http';
  const url = inferHttpUrl(config);
  if (!url) {
    return finalizeResult({
      transport,
      status: 'broken',
      reachable: false,
      phase: 'config',
      reasonCode: 'missing_transport',
      summary: 'MCP config does not define a reachable HTTP URL.',
      details: ['Add a "url" field or a valid port-based HTTP transport definition.'],
    });
  }

  const headers = normalizeHeaders(config.headers);
  const baseHeaders = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...headers,
  };

  try {
    const initializeBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'ai-ecosystem-map', version: '1.0.0' },
      },
    });

    const initResponse = await requestJson(url, {
      method: 'POST',
      headers: baseHeaders,
      body: initializeBody,
      timeoutMs,
    });

    if (initResponse.statusCode < 200 || initResponse.statusCode >= 300) {
      if (transport === 'sse') {
        const sseProbe = await inspectSseReachability(url, headers, timeoutMs);
        if (sseProbe.reasonCode !== 'protocol_mismatch') return sseProbe;
      }

      const failure = classifyRuntimeFailure(`HTTP ${initResponse.statusCode} ${initResponse.body || ''}`, {
        transport,
        phase: 'initialize',
        statusCode: initResponse.statusCode,
      });

      return finalizeResult({
        transport,
        status: 'broken',
        reachable: false,
        phase: 'initialize',
        reasonCode: failure.reasonCode,
        summary: failure.summary,
        details: [`Initialize returned HTTP ${initResponse.statusCode}.`],
      });
    }

    let initMessage;
    try {
      initMessage = JSON.parse(initResponse.body);
    } catch (err) {
      if (transport === 'sse') {
        const sseProbe = await inspectSseReachability(url, headers, timeoutMs);
        if (sseProbe.reasonCode !== 'protocol_mismatch') return sseProbe;
      }

      const failure = classifyRuntimeFailure(err.message, { transport, phase: 'initialize' });
      return finalizeResult({
        transport,
        status: 'broken',
        reachable: true,
        phase: 'initialize',
        reasonCode: failure.reasonCode,
        summary: failure.summary,
        details: ['Initialize response body was not valid JSON-RPC.'],
      });
    }

    if (initMessage?.error) {
      const failure = classifyRuntimeFailure(initMessage.error.message, { transport, phase: 'initialize' });
      return finalizeResult({
        transport,
        status: 'broken',
        reachable: true,
        phase: 'initialize',
        reasonCode: failure.reasonCode,
        summary: failure.summary,
        details: [initMessage.error.message || 'Initialize returned an MCP error.'],
      });
    }

    const sessionHeaders = { ...baseHeaders };
    const sessionId = initResponse.headers['mcp-session-id'];
    if (sessionId) {
      sessionHeaders['mcp-session-id'] = Array.isArray(sessionId) ? sessionId[0] : String(sessionId);
    }

    const toolsBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });

    const toolsResponse = await requestJson(url, {
      method: 'POST',
      headers: sessionHeaders,
      body: toolsBody,
      timeoutMs,
    });

    if (toolsResponse.statusCode < 200 || toolsResponse.statusCode >= 300) {
      const failure = classifyRuntimeFailure(`HTTP ${toolsResponse.statusCode} ${toolsResponse.body || ''}`, {
        transport,
        phase: 'tools_list',
        statusCode: toolsResponse.statusCode,
      });
      return finalizeResult({
        transport,
        status: 'broken',
        reachable: true,
        phase: 'tools_list',
        reasonCode: failure.reasonCode,
        summary: failure.summary,
        details: [`tools/list returned HTTP ${toolsResponse.statusCode}.`],
      });
    }

    let toolsMessage;
    try {
      toolsMessage = JSON.parse(toolsResponse.body);
    } catch (err) {
      const failure = classifyRuntimeFailure(err.message, { transport, phase: 'tools_list' });
      return finalizeResult({
        transport,
        status: 'broken',
        reachable: true,
        phase: 'tools_list',
        reasonCode: failure.reasonCode,
        summary: failure.summary,
        details: ['tools/list response body was not valid JSON-RPC.'],
      });
    }

    if (toolsMessage?.error) {
      const failure = classifyRuntimeFailure(toolsMessage.error.message, { transport, phase: 'tools_list' });
      return finalizeResult({
        transport,
        status: 'broken',
        reachable: true,
        phase: 'tools_list',
        reasonCode: failure.reasonCode,
        summary: failure.summary,
        details: [toolsMessage.error.message || 'tools/list returned an MCP error.'],
      });
    }

    const tools = Array.isArray(toolsMessage?.result?.tools)
      ? toolsMessage.result.tools.map(sanitizeTool)
      : [];

    return finalizeResult({
      transport,
      status: 'ok',
      reachable: true,
      phase: 'complete',
      reasonCode: 'ok',
      summary: tools.length > 0
        ? `Runtime check succeeded and listed ${tools.length} tool${tools.length === 1 ? '' : 's'}.`
        : 'Runtime check succeeded. The MCP endpoint is reachable but exposes no tools.',
      details: [
        'Initialize handshake completed successfully.',
        `tools/list returned ${tools.length} tool${tools.length === 1 ? '' : 's'}.`,
      ],
      tools,
      toolCount: tools.length,
    });
  } catch (err) {
    if (transport === 'sse') {
      try {
        const sseProbe = await inspectSseReachability(url, headers, timeoutMs);
        if (sseProbe.reasonCode !== 'protocol_mismatch') return sseProbe;
      } catch {
        // Fall through to generic classification.
      }
    }

    const failure = classifyRuntimeFailure(err.message, { transport, phase: 'connect' });
    return finalizeResult({
      transport,
      status: 'broken',
      reachable: false,
      phase: 'connect',
      reasonCode: failure.reasonCode,
      summary: failure.summary,
      details: [err.message],
    });
  }
}

async function runMcpDiagnostics(config, options = {}) {
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 15000;
  const transport = inferTransport(config);

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return finalizeResult({
      transport,
      status: 'broken',
      reachable: false,
      phase: 'config',
      reasonCode: 'missing_config',
      summary: 'MCP runtime check cannot run because the config payload is missing.',
      details: ['The asset does not expose a readable MCP config.'],
    });
  }

  if (transport === 'stdio') {
    return inspectStdioRuntime(config, timeoutMs);
  }

  if (transport === 'http' || transport === 'sse') {
    return inspectHttpRuntime(config, timeoutMs);
  }

  return finalizeResult({
    transport,
    status: 'broken',
    reachable: false,
    phase: 'config',
    reasonCode: 'missing_transport',
    summary: 'MCP runtime check cannot determine which transport to use.',
    details: ['Add a command for stdio or a URL for HTTP/SSE transport.'],
  });
}

function listMcpTools(config, timeout = 15000) {
  return runMcpDiagnostics(config, { timeoutMs: timeout }).then((result) => {
    if (result.status === 'ok') return result.tools;
    throw new Error(result.summary);
  });
}

function listHttpTools(url, timeout = 10000, headers = {}) {
  return runMcpDiagnostics({ url, headers }, { timeoutMs: timeout }).then((result) => {
    if (result.status === 'ok') return result.tools;
    throw new Error(result.summary);
  });
}

module.exports = {
  getMcpConfig,
  inferTransport,
  runMcpDiagnostics,
  listMcpTools,
  listHttpTools,
};
