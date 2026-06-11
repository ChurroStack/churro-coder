/**
 * HTTP transport for the churro-coder MCP server.
 *
 * Binds to 127.0.0.1 on an OS-picked port. Persists { port, bearer } to
 * <userData>/churro-mcp.json so the Codex bootstrap can reuse the bearer
 * token across restarts without re-generating it each time.
 *
 * Stateless mode: each POST creates a fresh McpServer + transport pair and
 * disposes them when the response closes. This is the canonical pattern from
 * the SDK's `simpleStatelessStreamableHttp` example — a single shared
 * transport returns 500s under concurrent or repeated requests.
 *
 * Single shared endpoint: all authenticated requests build a server via
 * `createMcpServer()`. Every tool requires `subChatId` as an argument; the
 * bootstrap layer is responsible for delivering subChatId to the CLI context
 * (system prompt, first-turn reminder, dispatcher messages).
 */

import { app } from 'electron';
import * as http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server';
import { getToolName, isInteractiveToolCall } from './interactive-tools';

interface McpHttpState {
  url: string;
  bearer: string;
  port: number;
  server: http.Server;
  restartCount: number;
}

let state: McpHttpState | null = null;
let nextRequestId = 1;
let restartInFlight: Promise<{ url: string; bearer: string; port: number }> | null = null;
let initInFlight: Promise<{ url: string; bearer: string; port: number }> | null = null;
const intentionallyClosingServers = new WeakSet<http.Server>();

function getMcpStatePath(): string {
  return join(app.getPath('userData'), 'churro-mcp.json');
}

async function loadSavedBearer(): Promise<string | null> {
  try {
    const raw = await readFile(getMcpStatePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.bearer === 'string' &&
      parsed.bearer.length > 0
    ) {
      return parsed.bearer;
    }
  } catch {
    // No saved state
  }
  return null;
}

async function persistState(port: number, bearer: string): Promise<void> {
  await writeFile(getMcpStatePath(), JSON.stringify({ port, bearer }), 'utf8');
}

function sendJsonRpcError(
  res: http.ServerResponse,
  statusCode: number,
  code: number,
  message: string,
  id: string | number | null = null
): void {
  if (res.headersSent) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message },
      id
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function summarizeJsonRpcBody(body: unknown): string {
  const envelope = Array.isArray(body) ? body[0] : body;
  if (!isRecord(envelope)) return 'rpc=unparseable';

  const method = typeof envelope.method === 'string' ? envelope.method : '(no-method)';
  const id = typeof envelope.id === 'string' || typeof envelope.id === 'number' ? envelope.id : 'none';
  const params = isRecord(envelope.params) ? envelope.params : {};
  const name = typeof params.name === 'string' ? params.name : undefined;
  const args = isRecord(params.arguments) ? params.arguments : {};
  const subChatId = typeof args.subChatId === 'string' ? args.subChatId : undefined;
  const argKeys = Object.keys(args);

  return [
    `rpc=${method}`,
    `id=${id}`,
    name ? `tool=${name}` : '',
    subChatId ? `sub=${subChatId}` : '',
    argKeys.length > 0 ? `argKeys=${argKeys.join(',')}` : ''
  ]
    .filter(Boolean)
    .join(' ');
}

function isToolCallBody(body: unknown): boolean {
  const envelope = Array.isArray(body) ? body[0] : body;
  return isRecord(envelope) && envelope.method === 'tools/call';
}

async function startMcpHttpServer(
  bearer: string,
  restartCount: number
): Promise<{ url: string; bearer: string; port: number; server: http.Server; restartCount: number }> {
  const MAX_BODY_BYTES = 1_048_576; // 1 MiB — MCP messages are small JSON-RPC envelopes
  const REQUEST_TIMEOUT_MS = 30_000;

  const server = http.createServer(async (req, res) => {
    const requestId = nextRequestId++;
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      console.warn(`[churro-coder] MCP HTTP request id=${requestId} timed out`);
      sendJsonRpcError(res, 408, -32001, 'Request timeout');
    });

    const authHeader = req.headers['authorization'] ?? '';
    if (authHeader !== `Bearer ${bearer}`) {
      console.warn(
        `[churro-coder] MCP HTTP request id=${requestId} rejected auth method=${req.method} hasAuth=${Boolean(authHeader)}`
      );
      sendJsonRpcError(res, 401, -32001, 'Unauthorized');
      return;
    }

    let body: unknown;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      let total = 0;
      try {
        for await (const chunk of req) {
          const buf = chunk as Buffer;
          total += buf.length;
          if (total > MAX_BODY_BYTES) {
            console.warn(`[churro-coder] MCP HTTP request id=${requestId} rejected size bytes=${total}`);
            sendJsonRpcError(res, 413, -32002, 'Payload too large');
            return;
          }
          chunks.push(buf);
        }
      } catch (err) {
        console.error(`[churro-coder] MCP HTTP request id=${requestId} body read failed:`, err);
        sendJsonRpcError(res, 500, -32603, `Body read failed: ${(err as Error).message}`);
        return;
      }
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        body = undefined;
      }
    }

    const shouldTraceRequest = isToolCallBody(body);
    if (shouldTraceRequest) {
      console.log(`[churro-coder] MCP HTTP request id=${requestId} method=${req.method} ${summarizeJsonRpcBody(body)}`);
    }

    // Interactive tools (request_user_input) block on a human and may hold the
    // response open for minutes. Disable the generic socket watchdog for them so
    // it can never reap the call; the tool's own backstop timer + the CLI's
    // per-server `timeout` govern the lifetime instead.
    if (isInteractiveToolCall(body)) {
      req.setTimeout(0);
      console.log(
        `[churro-coder] MCP HTTP request id=${requestId} watchdog disabled for interactive tool=${getToolName(body)}`
      );
    }

    const mcpServer = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on('close', () => {
      void transport.close().catch(() => {});
      void mcpServer.close().catch(() => {});
    });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
      if (shouldTraceRequest) {
        console.log(`[churro-coder] MCP HTTP request id=${requestId} handled`);
      }
    } catch (err) {
      console.error(`[churro-coder] Error handling MCP request id=${requestId}:`, err);
      sendJsonRpcError(res, 500, -32603, 'Internal server error');
    }
  });

  let bindReject: ((reason: Error) => void) | null = null;
  await new Promise<void>((resolve, reject) => {
    bindReject = reject;
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  if (bindReject) {
    server.removeListener('error', bindReject);
    bindReject = null;
  }

  const addr = server.address() as { port: number };
  const port = addr.port;
  const url = `http://127.0.0.1:${port}/`;

  // Only no-op when state has been committed to a *different* server.
  // A null state happens during the restart's own startup window — in that
  // case this server is the most recent and should be allowed to restart.
  const scheduleRestart = (reason: 'error' | 'close', error?: Error) => {
    if (intentionallyClosingServers.has(server)) return;
    if (state !== null && state.server !== server) return;
    void restartMcpHttpServer({ reason, error, expectedServer: server });
  };

  server.on('error', (error) => {
    console.error(
      `[churro-coder] MCP HTTP server stopped unexpectedly reason=error restartCount=${restartCount} message=${error.message}`
    );
    scheduleRestart('error', error);
  });

  server.on('close', () => {
    if (intentionallyClosingServers.has(server)) {
      return;
    }
    console.warn(`[churro-coder] MCP HTTP server stopped unexpectedly reason=close restartCount=${restartCount}`);
    scheduleRestart('close');
  });

  await persistState(port, bearer);
  console.log(`[churro-coder] HTTP transport listening on ${url} restartCount=${restartCount}`);

  return { url, bearer, port, server, restartCount };
}

export async function initMcpHttpServer(): Promise<{ url: string; bearer: string; port: number }> {
  // Coalesce against any in-flight crash-restart. A concurrent caller during a
  // restart window (state nulled while the new server is being bound) must
  // wait for the restart instead of starting a parallel server — two parallel
  // HTTP servers would leak the loser's socket and overwrite the state singleton.
  if (restartInFlight) {
    console.log('[mcp-bootstrap] init awaiting restart');
    return restartInFlight;
  }
  if (state) {
    return { url: state.url, bearer: state.bearer, port: state.port };
  }
  if (initInFlight) {
    console.log('[mcp-bootstrap] init reused in-flight');
    return initInFlight;
  }

  console.log('[mcp-bootstrap] init started');
  initInFlight = (async () => {
    const bearer = (await loadSavedBearer()) ?? randomUUID();
    state = await startMcpHttpServer(bearer, 0);
    console.log(`[mcp-bootstrap] init complete port=${state.port} restartCount=${state.restartCount}`);
    return { url: state.url, bearer: state.bearer, port: state.port };
  })();

  try {
    return await initInFlight;
  } finally {
    initInFlight = null;
  }
}

export function getMcpHttpEndpoint(): { url: string; bearer: string } | null {
  if (!state) return null;
  return { url: state.url, bearer: state.bearer };
}

/**
 * Verify the cached MCP HTTP server is actually reachable. Used by callers
 * (cli-harness bootstrap on hard-reset / restart) that must NOT hand out a
 * stale URL to a freshly-spawned CLI process: if the server was force-killed
 * by the OS (sleep/wake, OOM, etc.) without our `error`/`close` handlers
 * firing, `state` may still point at a dead socket. Any TCP-level response —
 * even a 401 — proves the server is alive; only a connection failure or
 * timeout counts as dead.
 */
async function pingMcpHttpServer(timeoutMs = 1000): Promise<boolean> {
  if (!state) return false;
  const url = state.url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    return res.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Like {@link initMcpHttpServer} but verifies the cached server is actually
 * alive before handing back its endpoint. If the cached server is unreachable
 * (force-killed, socket leaked, etc.) this closes the stale state and starts
 * a fresh server. Callers that are about to spawn a CLI process — most
 * importantly hard-reset / restart paths — should use this so the new CLI
 * gets a live URL written into its config file.
 */
export async function ensureMcpHttpServerAlive(): Promise<{ url: string; bearer: string; port: number }> {
  if (state) {
    const alive = await pingMcpHttpServer();
    if (alive) {
      console.log('[mcp-bootstrap] ensure-alive: cached server responsive');
      return { url: state.url, bearer: state.bearer, port: state.port };
    }
    console.warn('[mcp-bootstrap] ensure-alive: cached server unreachable, forcing close + reinit');
    try {
      await closeMcpHttpServer();
    } catch (err) {
      console.warn('[mcp-bootstrap] ensure-alive: close failed (continuing with reinit):', err);
    }
  }
  return initMcpHttpServer();
}

async function restartMcpHttpServer(params: {
  reason: 'error' | 'close';
  error?: Error;
  expectedServer?: http.Server;
}): Promise<{ url: string; bearer: string; port: number }> {
  if (restartInFlight) {
    return restartInFlight;
  }

  const previous = state;
  // Drop stale crash signals from a server that was already replaced.
  if (previous && params.expectedServer && previous.server !== params.expectedServer) {
    return { url: previous.url, bearer: previous.bearer, port: previous.port };
  }
  if (!previous) {
    return initMcpHttpServer();
  }

  restartInFlight = (async () => {
    const nextRestartCount = previous.restartCount + 1;
    intentionallyClosingServers.add(previous.server);
    state = null;
    await new Promise<void>((resolve) => previous.server.close(() => resolve()));
    const next = await startMcpHttpServer(previous.bearer, nextRestartCount);
    state = next;
    console.log(
      `[churro-coder] MCP HTTP server restarted reason=${params.reason} restartCount=${nextRestartCount} url=${next.url}`
    );
    return { url: next.url, bearer: next.bearer, port: next.port };
  })();

  try {
    return await restartInFlight;
  } finally {
    restartInFlight = null;
  }
}

export async function __simulateMcpHttpServerFailureForTest(kind: 'error' | 'close'): Promise<void> {
  if (!state) {
    throw new Error('MCP HTTP server not initialized');
  }

  if (kind === 'error') {
    state.server.emit('error', new Error('synthetic MCP HTTP server failure'));
  } else {
    await new Promise<void>((resolve) => state!.server.close(() => resolve()));
  }

  if (restartInFlight) {
    await restartInFlight;
  }
}

/** Stops the HTTP server and clears state. Used by tests; callable on app quit. */
export async function closeMcpHttpServer(): Promise<void> {
  if (!state) return;
  const current = state;
  intentionallyClosingServers.add(current.server);
  state = null;
  await new Promise<void>((resolve) => current.server.close(() => resolve()));
}
