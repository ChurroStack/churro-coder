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

import { readFileChanges, onFileChangesNotified } from '../../file-changes/file-changes-store';
import { registerNotifyFilesChangedTool } from './notify-files-changed';

async function makeClientServer() {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerNotifyFilesChangedTool(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'notify-files-changed-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('notify_files_changed tool', () => {
  test('persists file entries and returns success text', async () => {
    const { client } = await makeClientServer();

    const result = await client.callTool({
      name: 'notify_files_changed',
      arguments: {
        subChatId: 'sub-bound',
        files: [
          { path: '/repo/src/foo.ts', action: 'create' },
          { path: '/repo/src/bar.ts', action: 'update' }
        ]
      }
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('2 file change(s)');

    const data = await readFileChanges('sub-bound');
    expect(data).not.toBeNull();
    expect(data!.entries).toHaveLength(2);
    expect(data!.entries.find((e) => e.path === '/repo/src/foo.ts')?.action).toBe('create');
  });

  test('fires onFileChangesNotified event on successful call', async () => {
    const events: string[] = [];
    const off = onFileChangesNotified((e) => events.push(e.subChatId));

    const { client } = await makeClientServer();
    await client.callTool({
      name: 'notify_files_changed',
      arguments: { subChatId: 'sub-ev', files: [{ path: '/repo/foo.ts', action: 'update' }] }
    });

    off();
    expect(events).toContain('sub-ev');
  });

  test('source is "mcp" for stateless single-server design', async () => {
    const { client } = await makeClientServer();
    await client.callTool({
      name: 'notify_files_changed',
      arguments: { subChatId: 'sub-src', files: [{ path: '/repo/x.ts', action: 'create' }] }
    });

    const data = await readFileChanges('sub-src');
    expect(data!.entries[0]!.source).toBe('mcp');
  });

  test('errors when subChatId is missing from arguments', async () => {
    const { client } = await makeClientServer();

    const result = await client.callTool({
      name: 'notify_files_changed',
      arguments: { files: [{ path: '/repo/z.ts', action: 'create' }] }
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toMatch(/subChatId/);
  });
});
