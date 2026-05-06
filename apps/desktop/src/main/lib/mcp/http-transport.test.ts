import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

let tmpRoot: string;

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => tmpRoot
  }
}));

import { writeCurrentPlan } from '../plans/plan-store';
import { closeMcpHttpServer, getMcpHttpEndpoint, initMcpHttpServer } from './http-transport';

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'http-transport-test-'));
});

afterEach(async () => {
  await closeMcpHttpServer();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('http-transport', () => {
  test('initMcpHttpServer binds to 127.0.0.1 and returns url + bearer + port', async () => {
    const result = await initMcpHttpServer();
    expect(result.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(typeof result.bearer).toBe('string');
    expect(result.bearer.length).toBeGreaterThan(0);
    expect(result.port).toBeGreaterThan(0);
  });

  test('initMcpHttpServer is idempotent — second call returns same state', async () => {
    const first = await initMcpHttpServer();
    const second = await initMcpHttpServer();
    expect(second).toEqual(first);
  });

  test('getMcpHttpEndpoint returns null before init, populated after', async () => {
    expect(getMcpHttpEndpoint()).toBeNull();
    await initMcpHttpServer();
    const endpoint = getMcpHttpEndpoint();
    expect(endpoint).not.toBeNull();
    expect(endpoint!.bearer.length).toBeGreaterThan(0);
  });

  test('rejects request with no bearer (401)', async () => {
    const { url } = await initMcpHttpServer();
    const res = await fetch(url, { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  test('rejects request with wrong bearer (401)', async () => {
    const { url } = await initMcpHttpServer();
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-token' },
      body: '{}'
    });
    expect(res.status).toBe(401);
  });

  test('rejects body larger than 1 MiB (413)', async () => {
    const { url, bearer } = await initMcpHttpServer();
    const oversized = 'x'.repeat(1_048_577); // 1 MiB + 1
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json'
      },
      body: oversized
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe('Payload too large');
  });

  test('end-to-end: MCP client over HTTP can call read_plan', async () => {
    await writeCurrentPlan({
      subChatId: 's-1',
      content: '# E2E Plan\n\nbody',
      source: 'claude:ExitPlanMode',
      title: 'E2E Plan'
    });

    const { url, bearer } = await initMcpHttpServer();
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${bearer}` } }
    });
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(transport);

    try {
      const result = await client.callTool({
        name: 'read_plan',
        arguments: { subChatId: 's-1' }
      });
      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain('# E2E Plan');
    } finally {
      await client.close();
    }
  });

  test('end-to-end: stateless mode handles two sequential requests (regression)', async () => {
    // Per-request server+transport bug: a shared transport returned 500 on the
    // second request. This test guards against regressing that fix.
    await writeCurrentPlan({ subChatId: 'a', content: 'A', source: 's', title: 't' });
    await writeCurrentPlan({ subChatId: 'b', content: 'B', source: 's', title: 't' });

    const { url, bearer } = await initMcpHttpServer();

    const callOnce = async (subChatId: string) => {
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${bearer}` } }
      });
      const client = new Client({ name: 'test-client', version: '0.0.0' });
      await client.connect(transport);
      try {
        const result = await client.callTool({ name: 'read_plan', arguments: { subChatId } });
        const content = result.content as Array<{ type: string; text: string }>;
        return content[0].text;
      } finally {
        await client.close();
      }
    };

    const first = await callOnce('a');
    const second = await callOnce('b');
    expect(first).toContain('A');
    expect(second).toContain('B');
  });
});
