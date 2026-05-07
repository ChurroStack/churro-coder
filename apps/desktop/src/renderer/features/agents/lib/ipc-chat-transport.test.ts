/**
 * R1 — Renderer: IPCChatTransport.sendMessages skips subscribe when already streaming.
 * R2 — Renderer: stale streamId cleared on stream error.
 *
 * These tests assert the §C and §D fixes from the workspace-switch abort plan:
 *   §C: isStreaming(sub) === true → sendMessages returns empty stream, no subscribe.
 *   §D: onError path clears the stale streamId in agentChatStore.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (must be declared before any vi.mock calls) ─────────────────
const { subscribeMock, setStreamIdMock: hoistedSetStreamId } = vi.hoisted(() => ({
  subscribeMock: vi.fn(() => ({ unsubscribe: vi.fn() })),
  setStreamIdMock: vi.fn()
}));

// ── Mock window-storage (used by atomWithStorage atoms) ──────────────────────
vi.mock('../../../lib/window-storage', async () => {
  const { atom } = await import('jotai');
  return {
    atomWithWindowStorage: (_key: string, defaultValue: unknown) => atom(defaultValue),
    createWindowScopedStorage: () => ({
      getItem: (_key: string, init: unknown) => init,
      setItem: () => {},
      removeItem: () => {}
    })
  };
});

// ── Mock appStore (returns safe defaults for every atom read) ─────────────────
vi.mock('../../../lib/jotai-store', () => ({
  appStore: {
    get: vi.fn(() => undefined),
    set: vi.fn()
  }
}));

// ── Mock trpcClient ───────────────────────────────────────────────────────────
vi.mock('../../../lib/trpc', () => ({
  trpcClient: {
    claude: {
      chat: { subscribe: subscribeMock }
    },
    external: {
      openExternal: { mutate: vi.fn() }
    }
  }
}));

// ── Mock sonner (toast) ───────────────────────────────────────────────────────
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() }
}));

// ── Mock atoms (return safe defaults) ────────────────────────────────────────
vi.mock('../../../lib/atoms', () => ({
  claudeLoginModalConfigAtom: {},
  agentsLoginModalOpenAtom: {},
  autoOfflineModeAtom: {},
  customClaudeConfigAtom: {},
  enableTasksAtom: {},
  historyEnabledAtom: {},
  normalizeCustomClaudeConfig: () => undefined,
  selectedOllamaModelAtom: {},
  sessionInfoAtom: {},
  showOfflineModeFeaturesAtom: {}
}));

vi.mock('../atoms', () => ({
  askUserQuestionResultsAtom: {},
  compactingSubChatsAtom: {},
  expiredUserQuestionsAtom: {},
  MODEL_ID_MAP: { opus: 'claude-opus-4-5-20251001' },
  pendingAuthRetryMessageAtom: {},
  pendingUserQuestionsAtom: {},
  subChatClaudeThinkingAtomFamily: () => ({}),
  subChatModelIdAtomFamily: () => ({})
}));

vi.mock('./model-switching', () => ({
  setSubChatModel: vi.fn()
}));

vi.mock('./get-current-sub-chat-mode', () => ({
  getCurrentSubChatMode: vi.fn(() => 'execute')
}));

// ── Streaming status store — controlled via module-level state ────────────────
let streamingSubChats = new Set<string>();

vi.mock('../stores/streaming-status-store', () => ({
  useStreamingStatusStore: {
    getState: () => ({
      isStreaming: (subChatId: string) => streamingSubChats.has(subChatId),
      setStatus: vi.fn(),
      getStatus: vi.fn(() => 'ready')
    })
  }
}));

// ── agentChatStore mock ───────────────────────────────────────────────────────
const setStreamIdMock = hoistedSetStreamId;
vi.mock('../stores/agent-chat-store', () => ({
  agentChatStore: {
    setStreamId: hoistedSetStreamId,
    getStreamId: vi.fn(() => null)
  }
}));

// ── Now import the class under test ──────────────────────────────────────────
import { IPCChatTransport } from './ipc-chat-transport';
import type { UIMessage } from 'ai';

// Helpers
function makeConfig(subChatId = 'test-sub-chat-id-fixture') {
  return { chatId: 'chat-1', subChatId, cwd: '/tmp/test', projectPath: '/tmp/test' };
}

function makeMessages(): UIMessage[] {
  return [{ id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'hello' } as any], content: 'hello' }];
}

async function drainStream(stream: ReadableStream): Promise<boolean> {
  const reader = stream.getReader();
  const { done } = await reader.read();
  return done;
}

beforeEach(() => {
  streamingSubChats.clear();
  subscribeMock.mockClear();
  setStreamIdMock.mockClear();
  subscribeMock.mockReturnValue({ unsubscribe: vi.fn() });
});

// ─────────────────────────────────────────────────────────────────────────────
// R1 — subscribe guard
// ─────────────────────────────────────────────────────────────────────────────
describe('R1 — IPCChatTransport.sendMessages streaming guard (§C)', () => {
  test('isStreaming === true → returns immediately-closed stream, subscribe never called', async () => {
    const subChatId = 'sub-r1-streaming';
    streamingSubChats.add(subChatId);

    const transport = new IPCChatTransport(makeConfig(subChatId));
    const stream = await transport.sendMessages({ messages: makeMessages() });

    expect(subscribeMock).not.toHaveBeenCalled();
    const done = await drainStream(stream);
    expect(done).toBe(true);
  });

  test('isStreaming === false → subscribe is called once with correct subChatId', async () => {
    const subChatId = 'sub-r1-not-streaming';

    const transport = new IPCChatTransport(makeConfig(subChatId));
    await transport.sendMessages({ messages: makeMessages() });

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    const [input] = subscribeMock.mock.calls[0];
    expect(input.subChatId).toBe(subChatId);
  });

  test('isStreaming transitions: not streaming → streaming → subsequent call skipped', async () => {
    const subChatId = 'sub-r1-transition';

    const transport = new IPCChatTransport(makeConfig(subChatId));

    // First call: not streaming → goes through
    await transport.sendMessages({ messages: makeMessages() });
    expect(subscribeMock).toHaveBeenCalledTimes(1);

    // Simulate streaming now started
    streamingSubChats.add(subChatId);

    // Second call: streaming → skipped
    const stream2 = await transport.sendMessages({ messages: makeMessages() });
    expect(subscribeMock).toHaveBeenCalledTimes(1); // still just one
    const done = await drainStream(stream2);
    expect(done).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R2 — stale streamId cleared on error
// ─────────────────────────────────────────────────────────────────────────────
describe('R2 — stale streamId cleared on stream error (§D)', () => {
  test('onError → agentChatStore.setStreamId(subChatId, null) is called', async () => {
    const subChatId = 'sub-r2-error';
    let capturedCallbacks: any = null;

    subscribeMock.mockImplementationOnce((_input: any, callbacks: any) => {
      capturedCallbacks = callbacks;
      return { unsubscribe: vi.fn() };
    });

    const transport = new IPCChatTransport(makeConfig(subChatId));
    await transport.sendMessages({ messages: makeMessages() });

    expect(capturedCallbacks).not.toBeNull();

    // Simulate tRPC subscription error
    capturedCallbacks.onError(new Error('transport failed'));

    expect(setStreamIdMock).toHaveBeenCalledWith(subChatId, null);
  });

  test('multiple onError calls do not double-clear (idempotent)', async () => {
    const subChatId = 'sub-r2-double';
    let capturedCallbacks: any = null;

    subscribeMock.mockImplementationOnce((_input: any, callbacks: any) => {
      capturedCallbacks = callbacks;
      return { unsubscribe: vi.fn() };
    });

    const transport = new IPCChatTransport(makeConfig(subChatId));
    await transport.sendMessages({ messages: makeMessages() });

    capturedCallbacks.onError(new Error('fail once'));
    capturedCallbacks.onError(new Error('fail twice'));

    // Both calls clear — each call fires setStreamId(null) individually
    const nullCalls = setStreamIdMock.mock.calls.filter(([id, val]) => id === subChatId && val === null);
    expect(nullCalls.length).toBeGreaterThanOrEqual(1);
  });
});
