// @vitest-environment jsdom
/**
 * Task 3.4 — unit tests for useHarnessSendDispatcher.
 *
 * Covers: builtin no-op, CLI dispatch with prompt only,
 * CLI dispatchBuildPlan, CLI dispatchFixReviewIssues,
 * builtin dispatchBuildPlan (atom), builtin dispatchFixReviewIssues (atom).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createStore } from 'jotai';
import { Provider as JotaiProvider } from 'jotai';
import React from 'react';
import { useHarnessSendDispatcher, _resetMcpInjectedSessions } from './use-harness-send-dispatcher';
import { useAgentSubChatStore } from '../stores/sub-chat-store';
import { pendingBuildPlanSubChatIdAtom, pendingFixReviewIssuesAtom } from '../atoms';

// ── tRPC mock ─────────────────────────────────────────────────────────────────

const mockWriteMutate = vi.fn();
vi.mock('../../../lib/trpc', () => ({
  trpc: {
    terminal: {
      write: {
        useMutation: () => ({ mutate: mockWriteMutate })
      }
    }
  }
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const SUB_CHAT_ID = 'sc-disp-1';

function seedStore(harness: 'builtin' | 'claude-cli' | 'codex-cli') {
  useAgentSubChatStore.setState({
    chatId: 'ws-1',
    activeSubChatId: SUB_CHAT_ID,
    openSubChatIds: [SUB_CHAT_ID],
    allSubChats: [
      {
        id: SUB_CHAT_ID,
        name: 'Test',
        harness,
        projectId: 'proj-1',
        openspecChangeId: null
      }
    ]
  } as any);
}

function renderDispatcher(subChatId = SUB_CHAT_ID) {
  const store = createStore();
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(JotaiProvider, { store }, children);
  const result = renderHook(() => useHarnessSendDispatcher(subChatId), { wrapper });
  return { ...result, store };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const CLI_MCP_REMINDER = 'IMPORTANT: call write_plan before ExitPlanMode.';

beforeEach(() => {
  mockWriteMutate.mockClear();
  _resetMcpInjectedSessions();
  useAgentSubChatStore.setState({
    chatId: null,
    activeSubChatId: null,
    openSubChatIds: [],
    allSubChats: [],
    splitPaneIds: [],
    splitRatios: []
  } as any);
});

describe('useHarnessSendDispatcher — builtin', () => {
  test('dispatch() is a no-op for builtin (no terminal write)', () => {
    seedStore('builtin');
    const { result } = renderDispatcher();
    act(() => result.current.dispatch('hello'));
    expect(mockWriteMutate).not.toHaveBeenCalled();
  });

  test('dispatchBuildPlan() sets pendingBuildPlanSubChatIdAtom for builtin', () => {
    seedStore('builtin');
    const { result, store } = renderDispatcher();
    act(() => result.current.dispatchBuildPlan());
    expect(mockWriteMutate).not.toHaveBeenCalled();
    expect(store.get(pendingBuildPlanSubChatIdAtom)).toBe(SUB_CHAT_ID);
  });

  test('dispatchFixReviewIssues() sets pendingFixReviewIssuesAtom for builtin', () => {
    seedStore('builtin');
    const { result, store } = renderDispatcher();
    act(() => result.current.dispatchFixReviewIssues('fix this'));
    expect(mockWriteMutate).not.toHaveBeenCalled();
    expect(store.get(pendingFixReviewIssuesAtom)).toEqual({ subChatId: SUB_CHAT_ID, message: 'fix this' });
  });
});

describe('useHarnessSendDispatcher — claude-cli', () => {
  test('dispatch() first message sends bracketed-paste body then standalone \\r', () => {
    seedStore('claude-cli');
    const { result } = renderDispatcher();
    act(() => result.current.dispatch('my prompt'));
    expect(mockWriteMutate).toHaveBeenCalledTimes(2);
    expect(mockWriteMutate).toHaveBeenNthCalledWith(1, {
      paneId: `cli:${SUB_CHAT_ID}`,
      data: `\x1b[200~${CLI_MCP_REMINDER}\nmy prompt\x1b[201~`
    });
    expect(mockWriteMutate).toHaveBeenNthCalledWith(2, { paneId: `cli:${SUB_CHAT_ID}`, data: '\r' });
  });

  test('dispatch() subsequent message (single-line) uses plain CR', () => {
    seedStore('claude-cli');
    const { result } = renderDispatcher();
    // First call injects MCP reminder; second call does not.
    act(() => result.current.dispatch('first'));
    mockWriteMutate.mockClear();
    act(() => result.current.dispatch('my prompt'));
    expect(mockWriteMutate).toHaveBeenCalledWith({ paneId: `cli:${SUB_CHAT_ID}`, data: 'my prompt\r' });
  });

  test('dispatch() multi-line user text sends bracketed-paste body then standalone \\r', () => {
    seedStore('claude-cli');
    const { result } = renderDispatcher();
    // Prime MCP injection so this call is not the first message.
    act(() => result.current.dispatch('prime'));
    mockWriteMutate.mockClear();
    act(() => result.current.dispatch('line one\nline two'));
    expect(mockWriteMutate).toHaveBeenCalledTimes(2);
    expect(mockWriteMutate).toHaveBeenNthCalledWith(1, {
      paneId: `cli:${SUB_CHAT_ID}`,
      data: '\x1b[200~line one\nline two\x1b[201~'
    });
    expect(mockWriteMutate).toHaveBeenNthCalledWith(2, { paneId: `cli:${SUB_CHAT_ID}`, data: '\r' });
  });

  test('dispatchBuildPlan() writes approve instruction to terminal', () => {
    seedStore('claude-cli');
    const { result } = renderDispatcher();
    act(() => result.current.dispatchBuildPlan());
    expect(mockWriteMutate).toHaveBeenCalledWith({
      paneId: `cli:${SUB_CHAT_ID}`,
      data: expect.stringContaining('approved')
    });
  });

  test('dispatchBuildPlan() approval message contains write_tasks instruction', () => {
    seedStore('claude-cli');
    const { result } = renderDispatcher();
    act(() => result.current.dispatchBuildPlan());
    const calls = (mockWriteMutate.mock.calls as Array<[{ data: string }]>).map((c) => c[0].data).join('');
    expect(calls).toContain('write_tasks');
    expect(calls).toContain('update_task_status');
  });

  test('dispatchBuildPlan() for builtin sets pendingBuildPlanSubChatIdAtom and does NOT write to PTY', () => {
    seedStore('builtin');
    const { result, store } = renderDispatcher();
    act(() => result.current.dispatchBuildPlan());
    expect(mockWriteMutate).not.toHaveBeenCalled();
    expect(store.get(pendingBuildPlanSubChatIdAtom)).toBe(SUB_CHAT_ID);
  });

  test('dispatchFixReviewIssues() writes the message to the terminal', () => {
    seedStore('claude-cli');
    const { result } = renderDispatcher();
    act(() => result.current.dispatchFixReviewIssues('fix these issues now'));
    expect(mockWriteMutate).toHaveBeenCalledWith({
      paneId: `cli:${SUB_CHAT_ID}`,
      data: 'fix these issues now\r'
    });
  });
});

describe('useHarnessSendDispatcher — codex-cli', () => {
  test('dispatch() routes to terminal for codex-cli (subsequent message)', () => {
    seedStore('codex-cli');
    const { result } = renderDispatcher();
    // Prime MCP injection; second call is single-line plain CR.
    act(() => result.current.dispatch('prime'));
    mockWriteMutate.mockClear();
    act(() => result.current.dispatch('codex prompt'));
    expect(mockWriteMutate).toHaveBeenCalledWith({ paneId: `cli:${SUB_CHAT_ID}`, data: 'codex prompt\r' });
  });

  test('isCliHarness is true for codex-cli', () => {
    seedStore('codex-cli');
    const { result } = renderDispatcher();
    expect(result.current.isCliHarness).toBe(true);
  });
});

describe('useHarnessSendDispatcher — unknown subChatId defaults to builtin', () => {
  test('dispatch() is a no-op when subChatId not in store', () => {
    // store has no subchats
    const { result } = renderDispatcher('nonexistent-id');
    act(() => result.current.dispatch('test'));
    expect(mockWriteMutate).not.toHaveBeenCalled();
    expect(result.current.isCliHarness).toBe(false);
  });
});
