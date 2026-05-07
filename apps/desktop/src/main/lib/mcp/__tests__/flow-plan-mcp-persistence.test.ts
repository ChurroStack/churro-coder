import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpServerForSubChat } from '../server';
import { writeCurrentPlan } from '../../plans/plan-store';
import { closeMcpHttpServer, initMcpHttpServer } from '../http-transport';

let tmpRoot: string;

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => tmpRoot
  }
}));

async function connectBoundClient(subChatId: string) {
  const server = createMcpServerForSubChat(subChatId);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'flow-plan-mcp-persistence-'));
});

afterEach(async () => {
  await closeMcpHttpServer();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('plan MCP persistence flow', () => {
  test('fresh bound server can read a previously persisted plan', async () => {
    await writeCurrentPlan({
      subChatId: 'persist-1',
      content: '# Persisted Plan\n\n1. Step one',
      source: 'claude:ExitPlanMode',
      title: 'Persisted Plan'
    });

    const client = await connectBoundClient('persist-1');
    try {
      const result = await client.callTool({ name: 'read_plan', arguments: {} });
      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain('# Persisted Plan');
      expect(content[0].text).toContain('Step one');
    } finally {
      await client.close();
    }
  });

  test('fresh HTTP client can read the persisted plan by subChatId', async () => {
    await writeCurrentPlan({
      subChatId: 'persist-2',
      content: '# HTTP Plan\n\n1. Step one',
      source: 'codex:PlanWrite',
      title: 'HTTP Plan'
    });

    const { url, bearer } = await initMcpHttpServer();
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${bearer}` } }
    });
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(transport);

    try {
      const result = await client.callTool({ name: 'read_plan', arguments: { subChatId: 'persist-2' } });
      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain('# HTTP Plan');
    } finally {
      await client.close();
    }
  });
});
