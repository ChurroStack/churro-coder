/**
 * HTTP transport for the churro-memory MCP server.
 *
 * Binds to 127.0.0.1 on an OS-picked port. Persists { port, bearer } to
 * <userData>/churro-mcp.json so the Codex bootstrap can reuse the bearer
 * token across restarts without re-generating it each time.
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

function getMcpStatePath(): string {
  return join(app.getPath('userData'), 'churro-mcp.json');
}

async function loadSavedBearer(): Promise<string | null> {
  try {
    const raw = await readFile(getMcpStatePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.bearer === 'string' && parsed.bearer.length > 0) {
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

export async function initMcpHttpServer(): Promise<{ url: string; bearer: string; port: number }> {
  if (state) {
    return { url: state.url, bearer: state.bearer, port: state.port };
  }

  const bearer = (await loadSavedBearer()) ?? randomUUID();
  const mcpServer = createMcpServerStateless();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  const server = http.createServer(async (req, res) => {
    // Simple bearer-token auth check
    const authHeader = req.headers['authorization'] ?? '';
    if (authHeader !== `Bearer ${bearer}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Collect body for POST requests
    let body: unknown;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        body = undefined;
      }
    }

    await transport.handleRequest(req, res, body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  await mcpServer.connect(transport);

  const addr = server.address() as { port: number };
  const port = addr.port;
  const url = `http://127.0.0.1:${port}/`;

  await persistState(port, bearer);

  state = { url, bearer, port, server };

  console.log(`[churro-memory] HTTP transport listening on ${url}`);
  return { url, bearer, port };
}

export function getMcpHttpEndpoint(): { url: string; bearer: string } | null {
  if (!state) return null;
  return { url: state.url, bearer: state.bearer };
}
