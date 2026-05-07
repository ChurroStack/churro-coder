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
 * Named "http-transport" (not "codex-transport") so future non-SDK providers
 * that can't use per-turn SDK instance injection can reuse this same HTTP
 * endpoint.
 */

import { app } from 'electron';
import * as http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServerStateless } from './server';

interface McpHttpState {
  url: string;
  bearer: string;
  port: number;
  server: http.Server;
}

let state: McpHttpState | null = null;
let nextRequestId = 1;

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

export async function initMcpHttpServer(): Promise<{ url: string; bearer: string; port: number }> {
  if (state) {
    return { url: state.url, bearer: state.bearer, port: state.port };
  }

  const bearer = (await loadSavedBearer()) ?? randomUUID();

  const MAX_BODY_BYTES = 1_048_576; // 1 MiB — MCP messages are small JSON-RPC envelopes
  const REQUEST_TIMEOUT_MS = 30_000;

  const server = http.createServer(async (req, res) => {
    const requestId = nextRequestId++;
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      console.warn(`[churro-coder] MCP HTTP request id=${requestId} timed out`);
      sendJsonRpcError(res, 408, -32001, 'Request timeout');
    });

    // Simple bearer-token auth check
    const authHeader = req.headers['authorization'] ?? '';
    if (authHeader !== `Bearer ${bearer}`) {
      console.warn(
        `[churro-coder] MCP HTTP request id=${requestId} rejected auth method=${req.method} hasAuth=${Boolean(authHeader)}`
      );
      sendJsonRpcError(res, 401, -32001, 'Unauthorized');
      return;
    }

    // Collect body for POST requests with size cap
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

    // Per-request McpServer + transport (stateless mode requires this — the
    // shared-transport pattern returns 500 on the second request).
    const mcpServer = createMcpServerStateless();
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

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as { port: number };
  const port = addr.port;
  const url = `http://127.0.0.1:${port}/`;

  await persistState(port, bearer);

  state = { url, bearer, port, server };

  console.log(`[churro-coder] HTTP transport listening on ${url}`);
  return { url, bearer, port };
}

export function getMcpHttpEndpoint(): { url: string; bearer: string } | null {
  if (!state) return null;
  return { url: state.url, bearer: state.bearer };
}

/** Stops the HTTP server and clears state. Used by tests; callable on app quit. */
export async function closeMcpHttpServer(): Promise<void> {
  if (!state) return;
  const current = state;
  state = null;
  await new Promise<void>((resolve) => current.server.close(() => resolve()));
}
