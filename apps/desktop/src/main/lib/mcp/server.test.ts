import { describe, expect, test, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, type CreateMcpServerOptions } from './server';

// Tool handlers transitively import electron (app.getPath). We never hit those
// paths here — we only enumerate registered tools — so a minimal stub suffices.
vi.mock('electron', () => ({
  app: { getPath: (_name: string) => tmpdir() }
}));

async function listToolNames(options?: CreateMcpServerOptions): Promise<string[]> {
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  await client.close();
  await server.close();
  return names;
}

const ALWAYS_ON = [
  'notify_files_changed',
  'read_plan',
  'read_review',
  'update_task_status',
  'write_plan',
  'write_review',
  'write_tasks'
];

describe('createMcpServer request_user_input gating', () => {
  test('default (builtin) exposes request_user_input alongside the write/read tools', async () => {
    const names = await listToolNames();
    expect(names).toContain('request_user_input');
    for (const t of ALWAYS_ON) expect(names).toContain(t);
  });

  test('includeRequestUserInput:false (CLI transport) omits only request_user_input', async () => {
    const names = await listToolNames({ includeRequestUserInput: false });
    expect(names).not.toContain('request_user_input');
    // Every other tool stays available — we disable one tool, not the server.
    for (const t of ALWAYS_ON) expect(names).toContain(t);
  });
});
