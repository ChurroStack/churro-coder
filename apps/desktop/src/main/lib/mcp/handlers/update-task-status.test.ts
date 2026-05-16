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

import { writeTasks, readTasks, onTasksWritten } from '../../tasks/task-store';
import { registerUpdateTaskStatusTool } from './update-task-status';

async function makeClientServer(boundSubChatId?: string) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerUpdateTaskStatusTool(server, { boundSubChatId });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'update-task-status-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmpRoot, { recursive: true, force: true });
});

async function seedTasks(subChatId: string) {
  await writeTasks({
    subChatId,
    tasks: [
      { id: 'step-1', title: 'First step', status: 'pending' },
      { id: 'step-2', title: 'Second step', status: 'pending' }
    ],
    source: 'test'
  });
}

describe('update_task_status tool — bound server', () => {
  test('mutates only the targeted task status, preserving order and titles', async () => {
    await seedTasks('sub-mut');
    const { client } = await makeClientServer('sub-mut');

    const result = await client.callTool({
      name: 'update_task_status',
      arguments: { id: 'step-1', status: 'in_progress' }
    });

    expect(result.isError).toBeFalsy();
    const data = await readTasks('sub-mut');
    expect(data!.tasks[0]).toMatchObject({ id: 'step-1', title: 'First step', status: 'in_progress' });
    expect(data!.tasks[1]).toMatchObject({ id: 'step-2', title: 'Second step', status: 'pending' });
  });

  test('marks a task completed', async () => {
    await seedTasks('sub-done');
    const { client } = await makeClientServer('sub-done');
    await client.callTool({ name: 'update_task_status', arguments: { id: 'step-2', status: 'completed' } });

    const data = await readTasks('sub-done');
    expect(data!.tasks[1]!.status).toBe('completed');
  });

  test('errors with unknown-id message when id not in list', async () => {
    await seedTasks('sub-unk');
    const { client } = await makeClientServer('sub-unk');

    const result = await client.callTool({
      name: 'update_task_status',
      arguments: { id: 'nonexistent', status: 'completed' }
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('nonexistent');
    expect(content[0].text).toContain('write_tasks');
  });

  test('errors with no-list message when no task list exists yet', async () => {
    const { client } = await makeClientServer('sub-nolist');

    const result = await client.callTool({
      name: 'update_task_status',
      arguments: { id: 'step-1', status: 'in_progress' }
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('write_tasks');
    expect(content[0].text).toMatch(/No task list/);
  });

  test('fires onTasksWritten event on successful update', async () => {
    await seedTasks('sub-ev2');
    const events: string[] = [];
    const off = onTasksWritten((e) => events.push(e.subChatId));

    const { client } = await makeClientServer('sub-ev2');
    await client.callTool({ name: 'update_task_status', arguments: { id: 'step-1', status: 'in_progress' } });

    off();
    expect(events).toContain('sub-ev2');
  });

  test('concurrent write_tasks + update_task_status produces consistent result', async () => {
    await seedTasks('sub-conc');

    // Dispatch both simultaneously via the store API (bypasses MCP transport serialisation).
    const [, updateResult] = await Promise.all([
      writeTasks({
        subChatId: 'sub-conc',
        tasks: [
          { id: 'step-1', title: 'First step', status: 'pending' },
          { id: 'step-2', title: 'Second step', status: 'pending' },
          { id: 'step-3', title: 'Third step', status: 'pending' }
        ],
        source: 'test'
      }),
      // This update targets the old list; it will either win or lose the race but
      // must never corrupt the file (no partial write).
      import('../../tasks/task-store').then((m) =>
        m.updateTaskStatus({ subChatId: 'sub-conc', id: 'step-1', status: 'in_progress', source: 'test' })
      )
    ]);

    const data = await readTasks('sub-conc');
    expect(data).not.toBeNull();
    // File must be valid JSON with an array — never undefined or corrupt.
    expect(Array.isArray(data!.tasks)).toBe(true);
    // The update either applied to the old 2-item list (ok:true) or found the
    // id missing in the new 3-item list after write_tasks replaced it (ok:false).
    // Either way the result is typed and not an exception.
    expect(typeof updateResult).toBe('object');
  });
});

describe('update_task_status tool — stateless server', () => {
  test('uses input.subChatId when server is unbound', async () => {
    await seedTasks('free-sub');
    const { client } = await makeClientServer(undefined);
    const result = await client.callTool({
      name: 'update_task_status',
      arguments: { subChatId: 'free-sub', id: 'step-1', status: 'completed' }
    });
    expect(result.isError).toBeFalsy();
    const data = await readTasks('free-sub');
    expect(data!.tasks[0]!.status).toBe('completed');
  });

  test('errors when unbound and no subChatId provided', async () => {
    const { client } = await makeClientServer(undefined);
    const result = await client.callTool({
      name: 'update_task_status',
      arguments: { id: 'step-1', status: 'completed' }
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toMatch(/subChatId/);
  });
});
