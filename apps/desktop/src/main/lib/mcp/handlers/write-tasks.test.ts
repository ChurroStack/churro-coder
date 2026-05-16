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

import { readTasks, onTasksWritten } from '../../tasks/task-store';
import { registerWriteTasksTool } from './write-tasks';

async function makeClientServer(boundSubChatId?: string) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerWriteTasksTool(server, { boundSubChatId });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'write-tasks-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmpRoot, { recursive: true, force: true });
});

const SAMPLE_TASKS = [
  { id: 'step-1', title: 'First step', status: 'pending' as const },
  { id: 'step-2', title: 'Second step', status: 'pending' as const }
];

describe('write_tasks tool — bound server', () => {
  test('writes tasks and returns confirmation', async () => {
    const { client } = await makeClientServer('sub-bound');
    const result = await client.callTool({ name: 'write_tasks', arguments: { tasks: SAMPLE_TASKS } });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('2 task(s)');
    expect(content[0].text).toContain('pending:2');
  });

  test('written tasks can be read back identically', async () => {
    const { client } = await makeClientServer('sub-readback');
    await client.callTool({ name: 'write_tasks', arguments: { tasks: SAMPLE_TASKS } });

    const data = await readTasks('sub-readback');
    expect(data).not.toBeNull();
    expect(data!.tasks).toHaveLength(2);
    expect(data!.tasks[0]).toMatchObject({ id: 'step-1', title: 'First step', status: 'pending' });
    expect(data!.tasks[1]).toMatchObject({ id: 'step-2', title: 'Second step', status: 'pending' });
  });

  test('second write_tasks call fully replaces the list', async () => {
    const { client } = await makeClientServer('sub-replace');
    await client.callTool({ name: 'write_tasks', arguments: { tasks: SAMPLE_TASKS } });
    await client.callTool({
      name: 'write_tasks',
      arguments: { tasks: [{ id: 'only', title: 'Only task', status: 'in_progress' }] }
    });

    const data = await readTasks('sub-replace');
    expect(data!.tasks).toHaveLength(1);
    expect(data!.tasks[0]!.id).toBe('only');
  });

  test('rejects duplicate ids within the payload', async () => {
    const { client } = await makeClientServer('sub-dup');
    const result = await client.callTool({
      name: 'write_tasks',
      arguments: {
        tasks: [
          { id: 'dup', title: 'A', status: 'pending' },
          { id: 'dup', title: 'B', status: 'pending' }
        ]
      }
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toMatch(/[Dd]uplicate/);
  });

  test('rejects invalid status enum value', async () => {
    const { client } = await makeClientServer('sub-enum');
    const result = await client.callTool({
      name: 'write_tasks',
      arguments: { tasks: [{ id: 'x', title: 'X', status: 'done' }] }
    });
    expect(result.isError).toBe(true);
  });

  test('fires onTasksWritten event on successful write', async () => {
    const events: string[] = [];
    const off = onTasksWritten((e) => events.push(e.subChatId));

    const { client } = await makeClientServer('sub-event');
    await client.callTool({ name: 'write_tasks', arguments: { tasks: SAMPLE_TASKS } });

    off();
    expect(events).toContain('sub-event');
  });
});

describe('write_tasks tool — stateless server', () => {
  test('uses input.subChatId when server is unbound', async () => {
    const { client } = await makeClientServer(undefined);
    const result = await client.callTool({
      name: 'write_tasks',
      arguments: { subChatId: 'free-sub', tasks: SAMPLE_TASKS }
    });
    expect(result.isError).toBeFalsy();
    const data = await readTasks('free-sub');
    expect(data!.tasks).toHaveLength(2);
  });

  test('errors when unbound and no subChatId provided', async () => {
    const { client } = await makeClientServer(undefined);
    const result = await client.callTool({ name: 'write_tasks', arguments: { tasks: SAMPLE_TASKS } });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toMatch(/subChatId/);
  });
});
