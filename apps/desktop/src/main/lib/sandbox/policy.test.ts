import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// --- mocks must be declared before the module is imported ---

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/fake/userData') }
}));

vi.mock('../db', () => ({
  getDatabase: vi.fn(),
  chats: { id: 'chats.id' },
  projects: {},
  sandboxSettings: { id: 'sandboxSettings.id' },
  subChats: { id: 'subChats.id', chatId: 'subChats.chatId' }
}));

vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

import { resolveSandboxPolicy } from './policy';
import { getDatabase } from '../db';

const FAKE_USER_DATA = '/fake/userData';
const SESSIONS_BASE = path.join(FAKE_USER_DATA, 'claude-sessions');

function makeDb(subChatRows: { id: string }[], globalEnabled = true) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          get: () => {
            // sandboxSettings singleton row
            const t = table as { id: string };
            if (t?.id === 'sandboxSettings.id') {
              return {
                id: 'singleton',
                sandboxEnabled: globalEnabled,
                extraWritablePaths: '[]',
                extraDeniedPaths: '[]',
                allowToolchainCaches: true
              };
            }
            return null;
          },
          all: () => subChatRows
        })
      })
    })
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveSandboxPolicy — per-workspace session dirs', () => {
  it('includes a subChat session dir in writableRoots', async () => {
    vi.mocked(getDatabase).mockReturnValue(makeDb([{ id: 'sub-A1' }]) as ReturnType<typeof getDatabase>);

    const policy = await resolveSandboxPolicy('chat-A', os.tmpdir(), os.tmpdir());

    expect(policy.writableRoots).toContain(path.join(SESSIONS_BASE, 'sub-A1'));
  });

  it('includes all subChat session dirs for a workspace', async () => {
    vi.mocked(getDatabase).mockReturnValue(
      makeDb([{ id: 'sub-A1' }, { id: 'sub-A2' }]) as ReturnType<typeof getDatabase>
    );

    const policy = await resolveSandboxPolicy('chat-A', os.tmpdir(), os.tmpdir());

    expect(policy.writableRoots).toContain(path.join(SESSIONS_BASE, 'sub-A1'));
    expect(policy.writableRoots).toContain(path.join(SESSIONS_BASE, 'sub-A2'));
  });

  it('includes the chatId session dir (Ollama path)', async () => {
    vi.mocked(getDatabase).mockReturnValue(makeDb([]) as ReturnType<typeof getDatabase>);

    const policy = await resolveSandboxPolicy('chat-ollama', os.tmpdir(), os.tmpdir());

    expect(policy.writableRoots).toContain(path.join(SESSIONS_BASE, 'chat-ollama'));
  });

  it('does NOT include session dirs for a different workspace', async () => {
    // Workspace A has sub-A1; workspace B has sub-B1.
    // When queried for chat-A we return only A's sub-chats.
    vi.mocked(getDatabase).mockReturnValue(makeDb([{ id: 'sub-A1' }]) as ReturnType<typeof getDatabase>);

    const policy = await resolveSandboxPolicy('chat-A', os.tmpdir(), os.tmpdir());

    expect(policy.writableRoots).not.toContain(path.join(SESSIONS_BASE, 'sub-B1'));
  });

  it('writableRootsExpanded contains both resolved and realpath forms of session dirs', async () => {
    vi.mocked(getDatabase).mockReturnValue(makeDb([{ id: 'sub-X' }]) as ReturnType<typeof getDatabase>);

    const policy = await resolveSandboxPolicy('chat-X', os.tmpdir(), os.tmpdir());
    const sessionDir = path.join(SESSIONS_BASE, 'sub-X');

    // The expanded set must include at least the resolved form
    expect(policy.writableRootsExpanded).toContain(path.resolve(sessionDir));
  });
});
