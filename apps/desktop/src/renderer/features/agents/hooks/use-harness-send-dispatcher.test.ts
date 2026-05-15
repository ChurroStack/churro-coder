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
import { useHarnessSendDispatcher } from './use-harness-send-dispatcher';
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

beforeEach(() => {
  mockWriteMutate.mockClear();
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
  test('dispatch() writes text + newline to cli:<subChatId>', () => {
    seedStore('claude-cli');
    const { result } = renderDispatcher();
    act(() => result.current.dispatch('my prompt'));
    expect(mockWriteMutate).toHaveBeenCalledWith({ paneId: `cli:${SUB_CHAT_ID}`, data: 'my prompt\r' });
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
  test('dispatch() routes to terminal for codex-cli', () => {
    seedStore('codex-cli');
    const { result } = renderDispatcher();
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
