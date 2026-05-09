// Behavioral regression guards for the "approve plan → next message uses agent mode" bug.
//
// Each transport reads sub-chat mode at send time via getCurrentSubChatMode
// (which reads from the Zustand sub-chat store). The bug we fixed was: IPCChatTransport and CodexChatTransport
// fell back to a stale this.config.mode when the Zustand store lookup missed, and
// RemoteChatTransport never read dynamically at all. These tests reproduce the
// post-approval scenario (mode flipped to "execute" *after* transport construction)
// and assert the new mode reaches the boundary (trpcClient.subscribe input or
// fetch headers).
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

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

vi.mock('../../../lib/trpc', () => ({
  trpcClient: {
    claude: {
      chat: {
        subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
      }
    },
    codex: {
      chat: {
        subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
      }
    }
  }
}));

import { useAgentSubChatStore } from '../stores/sub-chat-store';
import { trpcClient } from '../../../lib/trpc';
import { IPCChatTransport } from './ipc-chat-transport';
import { CodexChatTransport } from './codex-chat-transport';
import { RemoteChatTransport } from './remote-chat-transport';

let testCounter = 0;
function nextSubChatId(): string {
  return `transport-mode-test-${++testCounter}`;
}

const claudeSubscribe = vi.mocked(trpcClient.claude.chat.subscribe);
const codexSubscribe = vi.mocked(trpcClient.codex.chat.subscribe);

beforeEach(() => {
  claudeSubscribe.mockClear();
  codexSubscribe.mockClear();
});

afterEach(() => {
  useAgentSubChatStore.setState({ allSubChats: [] });
});

describe('Transport mode propagation — regression guards', () => {
  test('IPCChatTransport sends current atom value to claude.chat.subscribe (not stale construction-time value)', async () => {
    const id = nextSubChatId();

    // Pre-approval state: mode is "plan", transport constructed
    useAgentSubChatStore.setState((s) => ({
      allSubChats: [
        ...s.allSubChats.filter((c) => c.id !== id),
        { id, name: 'test', created_at: new Date().toISOString(), mode: 'plan' as const }
      ]
    }));
    const transport = new IPCChatTransport({
      chatId: 'chat-1',
      subChatId: id,
      cwd: '/tmp'
    });

    // handleApprovePlan flips mode to "execute" AFTER construction
    useAgentSubChatStore.setState((s) => ({
      allSubChats: [
        ...s.allSubChats.filter((c) => c.id !== id),
        { id, name: 'test', created_at: new Date().toISOString(), mode: 'execute' as const }
      ]
    }));

    await transport.sendMessages({
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] } as any]
    });

    expect(claudeSubscribe).toHaveBeenCalledTimes(1);
    const [input] = claudeSubscribe.mock.calls[0] as [{ mode: string }, unknown];
    expect(input.mode).toBe('execute');
  });

  test("IPCChatTransport sends 'plan' when atom holds 'plan' — sanity check the read isn't hard-coded", async () => {
    const id = nextSubChatId();
    useAgentSubChatStore.setState((s) => ({
      allSubChats: [
        ...s.allSubChats.filter((c) => c.id !== id),
        { id, name: 'test', created_at: new Date().toISOString(), mode: 'plan' as const }
      ]
    }));
    const transport = new IPCChatTransport({
      chatId: 'chat-1',
      subChatId: id,
      cwd: '/tmp'
    });

    await transport.sendMessages({
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] } as any]
    });

    const [input] = claudeSubscribe.mock.calls[0] as [{ mode: string }, unknown];
    expect(input.mode).toBe('plan');
  });

  test('CodexChatTransport sends current atom value to codex.chat.subscribe (not stale construction-time value)', async () => {
    const id = nextSubChatId();

    useAgentSubChatStore.setState((s) => ({
      allSubChats: [
        ...s.allSubChats.filter((c) => c.id !== id),
        { id, name: 'test', created_at: new Date().toISOString(), mode: 'plan' as const }
      ]
    }));
    const transport = new CodexChatTransport({
      chatId: 'chat-1',
      subChatId: id,
      cwd: '/tmp',
      provider: 'codex'
    });

    useAgentSubChatStore.setState((s) => ({
      allSubChats: [
        ...s.allSubChats.filter((c) => c.id !== id),
        { id, name: 'test', created_at: new Date().toISOString(), mode: 'execute' as const }
      ]
    }));

    await transport.sendMessages({
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] } as any]
    });

    expect(codexSubscribe).toHaveBeenCalledTimes(1);
    const [input] = codexSubscribe.mock.calls[0] as [{ mode: string }, unknown];
    expect(input.mode).toBe('execute');
  });

  test("CodexChatTransport sends 'plan' when atom holds 'plan' — sanity check the read isn't hard-coded", async () => {
    const id = nextSubChatId();
    useAgentSubChatStore.setState((s) => ({
      allSubChats: [
        ...s.allSubChats.filter((c) => c.id !== id),
        { id, name: 'test', created_at: new Date().toISOString(), mode: 'plan' as const }
      ]
    }));
    const transport = new CodexChatTransport({
      chatId: 'chat-1',
      subChatId: id,
      cwd: '/tmp',
      provider: 'codex'
    });

    await transport.sendMessages({
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] } as any]
    });

    const [input] = codexSubscribe.mock.calls[0] as [{ mode: string }, unknown];
    expect(input.mode).toBe('plan');
  });
});

describe('RemoteChatTransport mode propagation — regression guard for the never-dynamic-read bug', () => {
  let originalWindow: unknown;

  beforeEach(() => {
    originalWindow = (globalThis as Record<string, unknown>).window;
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = originalWindow;
    }
  });

  test('RemoteChatTransport puts current atom value in the sub-chat-mode HTTP header (not stale construction-time value)', async () => {
    const streamFetch = vi.fn(async () => ({ ok: true, status: 200 }));
    const noopListener = vi.fn(() => vi.fn());
    (globalThis as Record<string, unknown>).window = {
      desktopApi: {
        streamFetch,
        onStreamChunk: noopListener,
        onStreamDone: noopListener,
        onStreamError: noopListener,
        getApiBaseUrl: vi.fn(async () => '')
      }
    };

    const id = nextSubChatId();
    useAgentSubChatStore.setState((s) => ({
      allSubChats: [
        ...s.allSubChats.filter((c) => c.id !== id),
        { id, name: 'test', created_at: new Date().toISOString(), mode: 'plan' as const }
      ]
    }));
    const transport = new RemoteChatTransport({
      chatId: 'chat-1',
      subChatId: id,
      subChatName: 'test',
      sandboxUrl: 'http://localhost:3000'
    });

    useAgentSubChatStore.setState((s) => ({
      allSubChats: [
        ...s.allSubChats.filter((c) => c.id !== id),
        { id, name: 'test', created_at: new Date().toISOString(), mode: 'execute' as const }
      ]
    }));

    await transport.sendMessages({
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] } as any]
    });

    expect(streamFetch).toHaveBeenCalledTimes(1);
    const [, , options] = streamFetch.mock.calls[0] as unknown as [string, string, { headers: Record<string, string> }];
    expect(options.headers['sub-chat-mode']).toBe('execute');
  });

  test("RemoteChatTransport sends 'plan' when atom holds 'plan' — sanity check the header isn't hard-coded", async () => {
    const streamFetch = vi.fn(async () => ({ ok: true, status: 200 }));
    const noopListener = vi.fn(() => vi.fn());
    (globalThis as Record<string, unknown>).window = {
      desktopApi: {
        streamFetch,
        onStreamChunk: noopListener,
        onStreamDone: noopListener,
        onStreamError: noopListener,
        getApiBaseUrl: vi.fn(async () => '')
      }
    };

    const id = nextSubChatId();
    useAgentSubChatStore.setState((s) => ({
      allSubChats: [
        ...s.allSubChats.filter((c) => c.id !== id),
        { id, name: 'test', created_at: new Date().toISOString(), mode: 'plan' as const }
      ]
    }));
    const transport = new RemoteChatTransport({
      chatId: 'chat-1',
      subChatId: id,
      subChatName: 'test',
      sandboxUrl: 'http://localhost:3000'
    });

    await transport.sendMessages({
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] } as any]
    });

    const [, , options] = streamFetch.mock.calls[0] as unknown as [string, string, { headers: Record<string, string> }];
    expect(options.headers['sub-chat-mode']).toBe('plan');
  });
});
