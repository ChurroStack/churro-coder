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

// `eq(field, value)` returns a marker the mock db can read to filter `.all()`.
// Field is the column mock (a string in our setup) — capture it verbatim.
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ __field: field, __value: value }))
}));

import { resolveSandboxPolicy } from './policy';
import { getDatabase } from '../db';

const FAKE_USER_DATA = '/fake/userData';
const SESSIONS_BASE = path.resolve(FAKE_USER_DATA, 'agent-sessions');

interface EqMarker {
  __field: unknown;
  __value: unknown;
}

/**
 * Stateful db mock. `subChatsByChatId` is the source of truth — `.where(eq(subChats.chatId, x)).all()`
 * actually filters by the eq marker so a missing/wrong filter in production code would surface here.
 */
function makeDb(subChatsByChatId: Record<string, { id: string }[]>) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: EqMarker) => ({
          get: () => {
            const t = table as { id: string };
            if (t?.id === 'sandboxSettings.id') {
              return {
                id: 'singleton',
                sandboxEnabled: true,
                extraWritablePaths: '[]',
                extraDeniedPaths: '[]',
                allowToolchainCaches: true
              };
            }
            return null;
          },
          all: () => {
            // Filter sub_chats rows by the captured `eq(subChats.chatId, chatId)` value.
            const t = table as { id: string };
            if (t?.id === 'subChats.id' && condition?.__field === 'subChats.chatId') {
              return subChatsByChatId[String(condition.__value)] ?? [];
            }
            return [];
          }
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
    vi.mocked(getDatabase).mockReturnValue(
      makeDb({ 'chat-A': [{ id: 'sub-A1' }] }) as unknown as ReturnType<typeof getDatabase>
    );

    const policy = await resolveSandboxPolicy('chat-A', os.tmpdir(), os.tmpdir());

    expect(policy.writableRoots).toContain(path.join(SESSIONS_BASE, 'sub-A1'));
  });

  it('includes all subChat session dirs for a workspace', async () => {
    vi.mocked(getDatabase).mockReturnValue(
      makeDb({ 'chat-A': [{ id: 'sub-A1' }, { id: 'sub-A2' }] }) as unknown as ReturnType<typeof getDatabase>
    );

    const policy = await resolveSandboxPolicy('chat-A', os.tmpdir(), os.tmpdir());

    expect(policy.writableRoots).toContain(path.join(SESSIONS_BASE, 'sub-A1'));
    expect(policy.writableRoots).toContain(path.join(SESSIONS_BASE, 'sub-A2'));
  });

  it('includes the chatId session dir (Ollama path)', async () => {
    vi.mocked(getDatabase).mockReturnValue(makeDb({}) as unknown as ReturnType<typeof getDatabase>);

    const policy = await resolveSandboxPolicy('chat-ollama', os.tmpdir(), os.tmpdir());

    expect(policy.writableRoots).toContain(path.join(SESSIONS_BASE, 'chat-ollama'));
  });

  it('does NOT leak workspace B session dirs into workspace A policy', async () => {
    // Both workspaces exist in the db; querying for chat-A must not return chat-B's rows.
    // This actually exercises the eq(subChats.chatId, chatId) filter in production code —
    // if the production code dropped the where clause, sub-B1 would leak in here.
    vi.mocked(getDatabase).mockReturnValue(
      makeDb({
        'chat-A': [{ id: 'sub-A1' }],
        'chat-B': [{ id: 'sub-B1' }]
      }) as unknown as ReturnType<typeof getDatabase>
    );

    const policy = await resolveSandboxPolicy('chat-A', os.tmpdir(), os.tmpdir());

    expect(policy.writableRoots).toContain(path.join(SESSIONS_BASE, 'sub-A1'));
    expect(policy.writableRoots).not.toContain(path.join(SESSIONS_BASE, 'sub-B1'));
    expect(policy.writableRoots).not.toContain(path.join(SESSIONS_BASE, 'chat-B'));
  });

  it('writableRootsExpanded contains the resolved form of session dirs', async () => {
    vi.mocked(getDatabase).mockReturnValue(
      makeDb({ 'chat-X': [{ id: 'sub-X' }] }) as unknown as ReturnType<typeof getDatabase>
    );

    const policy = await resolveSandboxPolicy('chat-X', os.tmpdir(), os.tmpdir());
    const sessionDir = path.join(SESSIONS_BASE, 'sub-X');

    expect(policy.writableRootsExpanded).toContain(path.resolve(sessionDir));
  });
});
