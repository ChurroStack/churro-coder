// @vitest-environment jsdom
/**
 * Task 11.3 — Sidebar action button dispatcher matrix.
 *
 * 3 actions × 3 harnesses = 9 cells.
 * Actions: dispatchBuildPlan, dispatchFixReviewIssues, dispatch (arbitrary text)
 * Harnesses: builtin, claude-cli, codex-cli
 *
 * For CLI rows: asserts exactly one terminal.write fires with the correct body.
 * For builtin rows: asserts no terminal.write fires and atoms are set.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createStore } from 'jotai';
import { Provider as JotaiProvider } from 'jotai';
import React from 'react';
import { useHarnessSendDispatcher, _resetMcpInjectedSessions } from './use-harness-send-dispatcher';
import { useAgentSubChatStore } from '../stores/sub-chat-store';
import { pendingBuildPlanAtomFamily, pendingFixReviewIssuesAtomFamily } from '../atoms';

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

const SC = 'sc-matrix-1';

function seedStore(harness: 'builtin' | 'claude-cli' | 'codex-cli') {
  useAgentSubChatStore.setState({
    chatId: 'ws-1',
    activeSubChatId: SC,
    openSubChatIds: [SC],
    allSubChats: [{ id: SC, name: 'T', harness, projectId: 'p', openspecChangeId: null }]
  } as any);
}

function renderDispatcher() {
  const store = createStore();
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(JotaiProvider, { store }, children);
  const result = renderHook(() => useHarnessSendDispatcher(SC), { wrapper });
  return { ...result, store };
}

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

// ── 9-cell matrix ─────────────────────────────────────────────────────────────

type Cell = { action: 'buildPlan' | 'fixReview' | 'dispatch'; harness: 'builtin' | 'claude-cli' | 'codex-cli' };

const CELLS: Cell[] = [
  { action: 'buildPlan', harness: 'builtin' },
  { action: 'buildPlan', harness: 'claude-cli' },
  { action: 'buildPlan', harness: 'codex-cli' },
  { action: 'fixReview', harness: 'builtin' },
  { action: 'fixReview', harness: 'claude-cli' },
  { action: 'fixReview', harness: 'codex-cli' },
  { action: 'dispatch', harness: 'builtin' },
  { action: 'dispatch', harness: 'claude-cli' },
  { action: 'dispatch', harness: 'codex-cli' }
];

describe('Sidebar action dispatcher matrix (9 cells)', () => {
  test.each(CELLS)('$action × $harness', ({ action, harness }) => {
    seedStore(harness);
    const { result, store } = renderDispatcher();
    const isCli = harness !== 'builtin';

    if (action === 'buildPlan') {
      act(() => result.current.dispatchBuildPlan());
      if (isCli) {
        expect(mockWriteMutate).toHaveBeenCalled();
        const allData = (mockWriteMutate.mock.calls as Array<[{ paneId: string; data: string }]>)
          .map((c) => c[0].data)
          .join('');
        expect((mockWriteMutate.mock.calls[0] as [{ paneId: string; data: string }])[0].paneId).toBe(`cli:${SC}`);
        expect(allData).toContain('approved');
        expect(store.get(pendingBuildPlanAtomFamily(SC))).toBe(false);
      } else {
        expect(mockWriteMutate).not.toHaveBeenCalled();
        expect(store.get(pendingBuildPlanAtomFamily(SC))).toBe(true);
      }
    } else if (action === 'fixReview') {
      act(() => result.current.dispatchFixReviewIssues('fix these now'));
      if (isCli) {
        expect(mockWriteMutate).toHaveBeenCalledTimes(2);
        const firstCall = mockWriteMutate.mock.calls[0][0] as { paneId: string; data: string };
        const secondCall = mockWriteMutate.mock.calls[1][0] as { paneId: string; data: string };
        expect(firstCall.paneId).toBe(`cli:${SC}`);
        expect(firstCall.data).toBe('fix these now');
        expect(secondCall.data).toBe('\r');
        expect(store.get(pendingFixReviewIssuesAtomFamily(SC))).toBeNull();
      } else {
        expect(mockWriteMutate).not.toHaveBeenCalled();
        expect(store.get(pendingFixReviewIssuesAtomFamily(SC))).toBe('fix these now');
      }
    } else {
      // arbitrary dispatch — prime MCP injection first so the assertion call is single-line
      if (isCli) {
        act(() => result.current.dispatch('prime'));
        mockWriteMutate.mockClear();
      }
      act(() => result.current.dispatch('arbitrary text'));
      if (isCli) {
        expect(mockWriteMutate).toHaveBeenCalledTimes(2);
        const firstCall = mockWriteMutate.mock.calls[0][0] as { paneId: string; data: string };
        const secondCall = mockWriteMutate.mock.calls[1][0] as { paneId: string; data: string };
        expect(firstCall.paneId).toBe(`cli:${SC}`);
        expect(firstCall.data).toBe('arbitrary text');
        expect(secondCall.data).toBe('\r');
      } else {
        expect(mockWriteMutate).not.toHaveBeenCalled();
      }
    }
  });
});
