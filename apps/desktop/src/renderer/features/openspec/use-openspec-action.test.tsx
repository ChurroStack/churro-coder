// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { Provider, createStore } from 'jotai';
import { pendingOpenSpecMessageAtom } from './atoms';
import { _resetMcpInjectedSessions } from '../agents/hooks/use-harness-send-dispatcher';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockMutateAsync = vi.hoisted(() => vi.fn());
const mockWriteMutate = vi.hoisted(() => vi.fn());
const mockUpdateModeMutate = vi.hoisted(() => vi.fn());

vi.mock('@/lib/trpc', () => ({
  trpc: {
    openspec: {
      openSubChatForChange: {
        useMutation: vi.fn(() => ({ mutateAsync: mockMutateAsync }))
      }
    },
    terminal: {
      write: {
        useMutation: vi.fn(() => ({ mutate: mockWriteMutate }))
      }
    },
    chats: {
      updateSubChatMode: {
        useMutation: vi.fn(() => ({ mutate: mockUpdateModeMutate }))
      }
    },
    useUtils: vi.fn(() => ({
      chats: {
        getSubChat: {
          setData: vi.fn(),
          invalidate: vi.fn().mockResolvedValue(undefined)
        }
      }
    }))
  }
}));

vi.mock('../agents/hooks/use-sub-chat-mode', () => ({
  useSubChatMode: vi.fn(() => ({ setMode: vi.fn() }))
}));

vi.mock('../agents/stores/sub-chat-store', () => ({
  useAgentSubChatStore: Object.assign(
    vi.fn(() => ({})),
    {
      getState: vi.fn(() => ({
        addToAllSubChats: vi.fn(),
        addToOpenSubChats: vi.fn(),
        setActiveSubChat: vi.fn(),
        updateSubChatMode: vi.fn()
      }))
    }
  )
}));

vi.mock('../agents/lib/model-switching', () => ({
  applyModeDefaultModelAndSwitchProvider: vi.fn()
}));

vi.mock('../agents/lib/session-reset', () => ({
  forceFreshSubChatSession: vi.fn()
}));

vi.mock('../../lib/jotai-store', () => ({
  appStore: { set: vi.fn() }
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { useOpenSpecAction } from './use-openspec-action';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SUB_CHAT_ID = 'sc-openspec-test-1';
const context = {
  chatId: 'chat-1',
  projectId: 'proj-1',
  changeId: 'change-1',
  changePath: 'openspec/changes/change-1'
};

function makeSubChat(harness: 'builtin' | 'claude-cli' | 'codex-cli') {
  return { id: SUB_CHAT_ID, harness, mode: 'execute', name: 'Test Change' };
}

function makeWrapper(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

afterEach(() => {
  vi.clearAllMocks();
  _resetMcpInjectedSessions();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useOpenSpecAction CLI routing [openspec/cli-action]', () => {
  test('claude-cli: writes expanded /opsx:apply prompt to terminal PTY', async () => {
    mockMutateAsync.mockResolvedValue(makeSubChat('claude-cli'));

    const store = createStore();
    const { result } = renderHook(() => useOpenSpecAction(context, SUB_CHAT_ID), {
      wrapper: makeWrapper(store)
    });

    await act(async () => {
      await result.current({ verb: 'apply', kind: 'apply' });
    });

    expect(mockWriteMutate).toHaveBeenCalled();
    const calls = mockWriteMutate.mock.calls as Array<[{ paneId: string; data: string }]>;
    expect(calls.some((c) => c[0].paneId === `cli:${SUB_CHAT_ID}`)).toBe(true);

    const allData = calls.map((c) => c[0].data).join('');
    expect(allData).toContain('Implement tasks from an OpenSpec change.');

    expect(store.get(pendingOpenSpecMessageAtom)).toBeNull();
  });

  test('codex-cli: writes literal $openspec-apply-change to PTY without local expansion', async () => {
    mockMutateAsync.mockResolvedValue(makeSubChat('codex-cli'));

    const store = createStore();
    const { result } = renderHook(() => useOpenSpecAction(context, SUB_CHAT_ID), {
      wrapper: makeWrapper(store)
    });

    await act(async () => {
      await result.current({ verb: 'apply', kind: 'apply' });
    });

    expect(mockWriteMutate).toHaveBeenCalled();
    const calls = mockWriteMutate.mock.calls as Array<[{ paneId: string; data: string }]>;
    expect(calls.some((c) => c[0].paneId === `cli:${SUB_CHAT_ID}`)).toBe(true);

    const allData = calls.map((c) => c[0].data).join('');
    // Codex receives the literal skill invocation — codex's own engine expands it.
    expect(allData).toContain('$openspec-apply-change');
    // Local prompt template MUST NOT have been applied for codex.
    expect(allData).not.toContain('Implement tasks from an OpenSpec change.');

    expect(store.get(pendingOpenSpecMessageAtom)).toBeNull();
  });

  test('codex-cli: archive verb maps to $openspec-archive-change', async () => {
    mockMutateAsync.mockResolvedValue(makeSubChat('codex-cli'));

    const store = createStore();
    const { result } = renderHook(() => useOpenSpecAction(context, SUB_CHAT_ID), {
      wrapper: makeWrapper(store)
    });

    await act(async () => {
      await result.current({ verb: 'archive', kind: 'execute' });
    });

    const calls = mockWriteMutate.mock.calls as Array<[{ paneId: string; data: string }]>;
    const allData = calls.map((c) => c[0].data).join('');
    expect(allData).toContain('$openspec-archive-change');
  });

  test('codex-cli: verify verb maps to $openspec-verify-change', async () => {
    mockMutateAsync.mockResolvedValue(makeSubChat('codex-cli'));

    const store = createStore();
    const { result } = renderHook(() => useOpenSpecAction(context, SUB_CHAT_ID), {
      wrapper: makeWrapper(store)
    });

    await act(async () => {
      await result.current({ verb: 'verify', kind: 'execute' });
    });

    const calls = mockWriteMutate.mock.calls as Array<[{ paneId: string; data: string }]>;
    const allData = calls.map((c) => c[0].data).join('');
    expect(allData).toContain('$openspec-verify-change');
  });

  test('codex-cli: apply with scope arg appends to $openspec-apply-change', async () => {
    mockMutateAsync.mockResolvedValue(makeSubChat('codex-cli'));

    const store = createStore();
    const { result } = renderHook(() => useOpenSpecAction(context, SUB_CHAT_ID), {
      wrapper: makeWrapper(store)
    });

    await act(async () => {
      await result.current({ verb: 'apply', args: '1.3', kind: 'apply' });
    });

    const calls = mockWriteMutate.mock.calls as Array<[{ paneId: string; data: string }]>;
    const allData = calls.map((c) => c[0].data).join('');
    expect(allData).toContain('$openspec-apply-change 1.3');
  });

  test('builtin: sets pendingOpenSpecMessageAtom and does NOT write to terminal', async () => {
    mockMutateAsync.mockResolvedValue(makeSubChat('builtin'));

    const store = createStore();
    const { result } = renderHook(() => useOpenSpecAction(context, SUB_CHAT_ID), {
      wrapper: makeWrapper(store)
    });

    await act(async () => {
      await result.current({ verb: 'apply', kind: 'apply' });
    });

    expect(mockWriteMutate).not.toHaveBeenCalled();

    const pending = store.get(pendingOpenSpecMessageAtom);
    expect(pending).not.toBeNull();
    expect(pending?.subChatId).toBe(SUB_CHAT_ID);
    expect(pending?.message).toBe('/opsx:apply');
  });
});
