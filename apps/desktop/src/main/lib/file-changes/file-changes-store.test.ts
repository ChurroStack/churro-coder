import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpRoot: string;

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => tmpRoot
  }
}));

import { notifyFilesChanged, readFileChanges, onFileChangesNotified } from './file-changes-store';

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'file-changes-store-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('file-changes-store', () => {
  test('round-trip: notify then read returns entries', async () => {
    await notifyFilesChanged({
      subChatId: 'sub-1',
      files: [
        { path: '/repo/src/foo.ts', action: 'create' },
        { path: '/repo/src/bar.ts', action: 'update' }
      ],
      source: 'claude-sdk'
    });

    const result = await readFileChanges('sub-1');
    expect(result).not.toBeNull();
    expect(result!.entries).toHaveLength(2);
    expect(result!.entries.find((e) => e.path === '/repo/src/foo.ts')?.action).toBe('create');
    expect(result!.entries.find((e) => e.path === '/repo/src/bar.ts')?.action).toBe('update');
    expect(result!.entries[0]!.source).toBe('claude-sdk');
    expect(typeof result!.entries[0]!.reportedAt).toBe('string');
  });

  test('readFileChanges returns null when no data exists', async () => {
    expect(await readFileChanges('does-not-exist')).toBeNull();
  });

  test('dedup by path: last write wins on action', async () => {
    await notifyFilesChanged({
      subChatId: 'sub-2',
      files: [{ path: '/repo/foo.ts', action: 'create' }],
      source: 'claude-sdk'
    });
    await notifyFilesChanged({
      subChatId: 'sub-2',
      files: [{ path: '/repo/foo.ts', action: 'update' }],
      source: 'claude-sdk'
    });

    const result = await readFileChanges('sub-2');
    expect(result!.entries).toHaveLength(1);
    expect(result!.entries[0]!.action).toBe('update');
  });

  test('accumulates entries across calls', async () => {
    await notifyFilesChanged({
      subChatId: 'sub-3',
      files: [{ path: '/repo/a.ts', action: 'create' }],
      source: 'claude-sdk'
    });
    await notifyFilesChanged({
      subChatId: 'sub-3',
      files: [{ path: '/repo/b.ts', action: 'update' }],
      source: 'claude-sdk'
    });

    const result = await readFileChanges('sub-3');
    expect(result!.entries).toHaveLength(2);
  });

  test('fires onFileChangesNotified event', async () => {
    const events: string[] = [];
    const off = onFileChangesNotified((e) => events.push(e.subChatId));

    await notifyFilesChanged({
      subChatId: 'sub-ev',
      files: [{ path: '/repo/foo.ts', action: 'create' }],
      source: 'claude-sdk'
    });

    off();
    expect(events).toContain('sub-ev');
  });

  test('isolates entries per sub-chat', async () => {
    await notifyFilesChanged({
      subChatId: 'a',
      files: [{ path: '/repo/a.ts', action: 'create' }],
      source: 'claude-sdk'
    });
    await notifyFilesChanged({
      subChatId: 'b',
      files: [{ path: '/repo/b.ts', action: 'update' }],
      source: 'claude-sdk'
    });

    const a = await readFileChanges('a');
    const b = await readFileChanges('b');
    expect(a!.entries).toHaveLength(1);
    expect(b!.entries).toHaveLength(1);
    expect(a!.entries[0]!.path).toBe('/repo/a.ts');
    expect(b!.entries[0]!.path).toBe('/repo/b.ts');
  });

  test('accepts delete action', async () => {
    await notifyFilesChanged({
      subChatId: 'sub-del',
      files: [{ path: '/repo/old.ts', action: 'delete' }],
      source: 'codex-http'
    });

    const result = await readFileChanges('sub-del');
    expect(result!.entries[0]!.action).toBe('delete');
    expect(result!.entries[0]!.source).toBe('codex-http');
  });
});
