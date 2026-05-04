import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  getOrCreateChat,
  type ChatLike,
  type FactoryInput,
  type ResolvedCreateInput,
  type TransportFactoryDeps
} from './transport-factory';
import type { ProviderId } from '../machines/transport-lifecycle';

/**
 * L2 tests for transport-factory.
 *
 * Uses fake Chat objects + fake transport markers so the test runs in a
 * Node environment with no SDK / IPC / electron deps. The factory's job is
 * to wire the FSM decision to the side effect — these tests verify the
 * wiring matches the rules documented in PR #44 (no recreate when in-flight
 * messages exist) and PR #40 (no stale config; mode read at send-time).
 */

interface FakeTransport {
  __kind: 'fake-transport';
  provider: ProviderId;
  subChatId: string;
}

interface FakeChat extends ChatLike {
  id: string;
  transport: FakeTransport;
  messages: unknown[];
}

function makeFakeChat(subChatId: string, provider: ProviderId, messages: unknown[] = []): FakeChat {
  return {
    id: subChatId,
    transport: { __kind: 'fake-transport', provider, subChatId },
    messages
  };
}

interface Harness {
  deps: TransportFactoryDeps<FakeChat>;
  store: Map<string, FakeChat>;
  persisted: Map<string, unknown[]>;
  isStreamingMap: Map<string, boolean>;
  hasQueueMap: Map<string, boolean>;
  staleRuntime: boolean;
  createCalls: ResolvedCreateInput[];
  deleteCalls: string[];
}

function makeHarness(
  opts: {
    existing?: FakeChat;
    persistedMessages?: unknown[];
    isStreaming?: boolean;
    hasQueue?: boolean;
    isStaleRuntime?: boolean;
  } = {}
): Harness {
  const store = new Map<string, FakeChat>();
  const persisted = new Map<string, unknown[]>();
  const isStreamingMap = new Map<string, boolean>();
  const hasQueueMap = new Map<string, boolean>();
  const createCalls: ResolvedCreateInput[] = [];
  const deleteCalls: string[] = [];

  if (opts.existing) {
    store.set(opts.existing.id, opts.existing);
  }
  if (opts.persistedMessages) {
    // Apply to whatever subChatId the test queries.
  }

  const deps: TransportFactoryDeps<FakeChat> = {
    readExistingChat: vi.fn((subChatId: string) => store.get(subChatId) ?? null),
    readChatMessages: vi.fn((chat: FakeChat) => chat.messages),
    readPersistedMessages: vi.fn((subChatId: string) => persisted.get(subChatId) ?? opts.persistedMessages ?? []),
    isStreaming: vi.fn((subChatId: string) => isStreamingMap.get(subChatId) ?? opts.isStreaming ?? false),
    hasQueue: vi.fn((subChatId: string) => hasQueueMap.get(subChatId) ?? opts.hasQueue ?? false),
    isStaleRuntime: vi.fn(() => opts.isStaleRuntime ?? false),
    getExistingProvider: vi.fn((chat: FakeChat) => chat.transport.provider),
    deleteExistingChat: vi.fn((subChatId: string) => {
      deleteCalls.push(subChatId);
      store.delete(subChatId);
    }),
    createChat: vi.fn((input: ResolvedCreateInput) => {
      createCalls.push(input);
      return makeFakeChat(input.subChatId, input.provider);
    }),
    storeChat: vi.fn((subChatId: string, chat: FakeChat) => {
      store.set(subChatId, chat);
    }),
    log: () => {}
  };

  return {
    deps,
    store,
    persisted,
    isStreamingMap,
    hasQueueMap,
    staleRuntime: !!opts.isStaleRuntime,
    createCalls,
    deleteCalls
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getOrCreateChat — CREATE when no existing chat', () => {
  test('no existing → createChat called with target provider, action=create', () => {
    const h = makeHarness();
    const input: FactoryInput = {
      subChatId: 'sub-1',
      targetProvider: 'claude-code',
      targetIsRemote: false
    };
    const result = getOrCreateChat(input, h.deps);

    expect(result.action).toMatchObject({ kind: 'create', provider: 'claude-code' });
    expect(h.createCalls).toHaveLength(1);
    expect(h.createCalls[0]).toMatchObject({
      subChatId: 'sub-1',
      provider: 'claude-code',
      reason: 'create'
    });
    expect(h.deps.storeChat).toHaveBeenCalledTimes(1);
    expect(result.chat?.id).toBe('sub-1');
  });

  test('targetIsRemote=true is propagated to createChat', () => {
    const h = makeHarness();
    const input: FactoryInput = {
      subChatId: 'sub-2',
      targetProvider: 'claude-code',
      targetIsRemote: true
    };
    getOrCreateChat(input, h.deps);
    expect(h.createCalls[0].isRemote).toBe(true);
  });
});

describe('getOrCreateChat — KEEP existing transport', () => {
  test('provider matches → KEEP, no createChat / deleteExistingChat', () => {
    const existing = makeFakeChat('sub-1', 'claude-code', [{ role: 'user' }]);
    const h = makeHarness({
      existing,
      persistedMessages: [{ role: 'user' }]
    });
    const result = getOrCreateChat(
      { subChatId: 'sub-1', targetProvider: 'claude-code', targetIsRemote: false },
      h.deps
    );
    expect(result.action).toEqual({ kind: 'keep' });
    expect(result.chat).toBe(existing);
    expect(h.createCalls).toHaveLength(0);
    expect(h.deleteCalls).toHaveLength(0);
  });

  test('PR #44 — cross-provider WITH messages → KEEP', () => {
    const existing = makeFakeChat('sub-1', 'claude-code', [{ role: 'user' }]);
    const h = makeHarness({
      existing,
      persistedMessages: [{ role: 'user' }]
    });
    const result = getOrCreateChat({ subChatId: 'sub-1', targetProvider: 'codex', targetIsRemote: false }, h.deps);
    expect(result.action).toEqual({ kind: 'keep' });
    expect(h.createCalls).toHaveLength(0);
    expect(h.deleteCalls).toHaveLength(0);
  });
});

describe('getOrCreateChat — RECREATE', () => {
  test('stale runtime + idle → RECREATE(stale-runtime)', () => {
    const existing = makeFakeChat('sub-1', 'claude-code', [{ role: 'user' }]);
    const h = makeHarness({
      existing,
      persistedMessages: [],
      isStaleRuntime: true
    });
    const result = getOrCreateChat(
      { subChatId: 'sub-1', targetProvider: 'claude-code', targetIsRemote: false },
      h.deps
    );
    expect(result.action.kind).toBe('recreate');
    if (result.action.kind === 'recreate') {
      expect(result.action.reason).toBe('stale-runtime');
    }
    expect(h.deleteCalls).toEqual(['sub-1']);
    expect(h.createCalls).toHaveLength(1);
    expect(h.createCalls[0].reason).toBe('recreate');
  });

  test('cross-provider with NO messages → RECREATE(cross-provider-empty)', () => {
    const existing = makeFakeChat('sub-1', 'claude-code', []);
    const h = makeHarness({
      existing,
      persistedMessages: []
    });
    const result = getOrCreateChat({ subChatId: 'sub-1', targetProvider: 'codex', targetIsRemote: false }, h.deps);
    expect(result.action.kind).toBe('recreate');
    if (result.action.kind === 'recreate') {
      expect(result.action.reason).toBe('cross-provider-empty');
      expect(result.action.provider).toBe('codex');
    }
    expect(h.deleteCalls).toEqual(['sub-1']);
  });
});

describe('getOrCreateChat — RECREATE order', () => {
  test('deleteExistingChat runs BEFORE createChat (so storeChat overwrites cleanly)', () => {
    const existing = makeFakeChat('sub-1', 'claude-code', []);
    const h = makeHarness({
      existing,
      persistedMessages: []
    });
    getOrCreateChat({ subChatId: 'sub-1', targetProvider: 'codex', targetIsRemote: false }, h.deps);

    // Pull the call orders out of the mock.
    const deleteCallOrder = (h.deps.deleteExistingChat as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const createCallOrder = (h.deps.createChat as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(deleteCallOrder).toBeLessThan(createCallOrder);
  });
});

describe('getOrCreateChat — streaming guard', () => {
  test("stale runtime + STREAMING → KEEP (don't tear down active stream)", () => {
    const existing = makeFakeChat('sub-1', 'claude-code', [{ role: 'user' }]);
    const h = makeHarness({
      existing,
      persistedMessages: [],
      isStaleRuntime: true,
      isStreaming: true
    });
    const result = getOrCreateChat(
      { subChatId: 'sub-1', targetProvider: 'claude-code', targetIsRemote: false },
      h.deps
    );
    expect(result.action).toEqual({ kind: 'keep' });
    expect(h.deleteCalls).toHaveLength(0);
  });

  test('stale runtime + queue waiting → KEEP', () => {
    const existing = makeFakeChat('sub-1', 'claude-code', [{ role: 'user' }]);
    const h = makeHarness({
      existing,
      isStaleRuntime: true,
      hasQueue: true
    });
    const result = getOrCreateChat(
      { subChatId: 'sub-1', targetProvider: 'claude-code', targetIsRemote: false },
      h.deps
    );
    expect(result.action).toEqual({ kind: 'keep' });
  });
});

describe('getOrCreateChat — no `mode` in createChat input (PR #40)', () => {
  test('createChat input omits mode field — transports must read mode at send-time', () => {
    const h = makeHarness();
    getOrCreateChat({ subChatId: 'sub-1', targetProvider: 'claude-code', targetIsRemote: false }, h.deps);
    const createInput = h.createCalls[0];
    expect('mode' in createInput).toBe(false);
  });
});

describe("getOrCreateChat — provider returned matches the chat's transport", () => {
  test('CREATE returns provider field consistent with action', () => {
    const h = makeHarness();
    const result = getOrCreateChat({ subChatId: 'sub-1', targetProvider: 'codex', targetIsRemote: false }, h.deps);
    expect(result.provider).toBe('codex');
  });

  test("KEEP returns existing chat's provider, not target", () => {
    const existing = makeFakeChat('sub-1', 'codex', [{ role: 'user' }]);
    const h = makeHarness({
      existing,
      persistedMessages: [{ role: 'user' }]
    });
    const result = getOrCreateChat(
      { subChatId: 'sub-1', targetProvider: 'claude-code', targetIsRemote: false },
      h.deps
    );
    expect(result.action).toEqual({ kind: 'keep' });
    expect(result.provider).toBe('codex');
  });
});
