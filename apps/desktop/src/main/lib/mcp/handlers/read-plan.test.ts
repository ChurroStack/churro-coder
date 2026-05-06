import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

let tmpRoot: string;

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => tmpRoot
  }
}));

import { writeCurrentPlan } from '../../plans/plan-store';
import { registerReadPlanTool } from './read-plan';

async function makeClientServer(boundSubChatId?: string) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerReadPlanTool(server, { boundSubChatId });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'read-plan-test-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('read_plan tool', () => {
  test('returns plan content when bound subChatId has a plan', async () => {
    await writeCurrentPlan({
      subChatId: 'bound-1',
      content: '# Plan body\n\nstep 1',
      source: 'claude:ExitPlanMode',
      title: 'Plan body'
    });

    const { client } = await makeClientServer('bound-1');
    const result = await client.callTool({ name: 'read_plan', arguments: {} });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].type).toBe('text');
    expect(content[0].text).toContain('# Plan body');
    expect(content[0].text).toContain('step 1');
    expect(content[0].text).toContain('Source: claude:ExitPlanMode');
  });

  test('uses input.subChatId when server is unbound', async () => {
    await writeCurrentPlan({ subChatId: 'free-1', content: 'free body', source: 's', title: 't' });

    const { client } = await makeClientServer(undefined);
    const result = await client.callTool({
      name: 'read_plan',
      arguments: { subChatId: 'free-1' }
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('free body');
  });

  test('errors when unbound and no subChatId is provided (schema-level rejection)', async () => {
    // The unbound schema marks subChatId required so the model's tool-call
    // layer cannot silently drop it; the MCP SDK rejects with -32602.
    const { client } = await makeClientServer(undefined);
    const result = await client.callTool({ name: 'read_plan', arguments: {} });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toMatch(/subChatId/);
    expect(content[0].text).toMatch(/Required|invalid_type/);
  });

  test('errors with friendly message when no plan exists', async () => {
    const { client } = await makeClientServer('missing');
    const result = await client.callTool({ name: 'read_plan', arguments: {} });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toMatch(/No plan has been recorded/);
  });

  test('bound subChatId wins over input.subChatId', async () => {
    await writeCurrentPlan({ subChatId: 'bound', content: 'BOUND', source: 's', title: 't' });
    await writeCurrentPlan({ subChatId: 'other', content: 'OTHER', source: 's', title: 't' });

    const { client } = await makeClientServer('bound');
    const result = await client.callTool({
      name: 'read_plan',
      arguments: { subChatId: 'other' }
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('BOUND');
    expect(content[0].text).not.toContain('OTHER');
  });

  test('exposes plan meta as structuredContent', async () => {
    await writeCurrentPlan({
      subChatId: 's-meta',
      content: 'body',
      source: 'codex:PlanWrite',
      title: 'Meta Title'
    });

    const { client } = await makeClientServer('s-meta');
    const result = await client.callTool({ name: 'read_plan', arguments: {} });

    expect(result.structuredContent).toMatchObject({
      source: 'codex:PlanWrite',
      title: 'Meta Title'
    });
  });
});
