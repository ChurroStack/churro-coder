// @vitest-environment jsdom
/**
 * Unit tests for useCliBusyTracker — verifies that PTY 'running' / 'idle'
 * transitions are mirrored into the two shared stores that drive the working
 * spinners across tabs, sidebars, quick-switch, and workflow widgets.
 * [cli-busy-tracker/shared-spinner-stores]
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import React from 'react';

const mockStateSubscriptionCallbacks = vi.hoisted(() => ({
  onData: null as ((evt: { paneId: string; state: 'idle' | 'running' }) => void) | null,
  enabled: false as boolean
}));

const mockInvalidate = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      chats: {
        getCurrentTasks: { invalidate: mockInvalidate },
        getCurrentPlan: { invalidate: mockInvalidate },
        getCurrentReview: { invalidate: mockInvalidate },
        getReviewContent: { invalidate: mockInvalidate },
        getPrStatus: { invalidate: mockInvalidate },
        get: { invalidate: mockInvalidate }
      },
      changes: {
        getStatus: { invalidate: mockInvalidate },
        getBranches: { invalidate: mockInvalidate }
      }
    }),
    terminal: {
      state: {
        useSubscription: vi.fn(
          (
            _paneId: string,
            opts: {
              enabled?: boolean;
              onData?: (evt: { paneId: string; state: 'idle' | 'running' }) => void;
            }
          ) => {
            mockStateSubscriptionCallbacks.enabled = opts?.enabled ?? false;
            if (opts?.onData) mockStateSubscriptionCallbacks.onData = opts.onData;
          }
        )
      }
    }
  }
}));

import { useCliBusyTracker } from './use-cli-busy-tracker';
import { useStreamingStatusStore } from '../stores/streaming-status-store';
import { loadingSubChatsAtom, cliBusyAtomFamily, agentFinishedTickAtomFamily } from '../atoms';

const SUB = 'sc-busy-1';
const PARENT = 'chat-busy-1';

function renderTracker(opts: { isCliHarness?: boolean; subChatId?: string | null; parentChatId?: string | null } = {}) {
  const store = createStore();
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(JotaiProvider, { store }, children);
  const result = renderHook(
    () =>
      useCliBusyTracker({
        subChatId: opts.subChatId ?? SUB,
        parentChatId: opts.parentChatId ?? PARENT,
        isCliHarness: opts.isCliHarness ?? true
      }),
    { wrapper }
  );
  return { ...result, store };
}

beforeEach(() => {
  mockInvalidate.mockClear();
  mockStateSubscriptionCallbacks.onData = null;
  mockStateSubscriptionCallbacks.enabled = false;
  useStreamingStatusStore.setState({ statuses: {} });
});

afterEach(() => {
  cleanup();
});

describe('useCliBusyTracker — shared spinner stores [cli-busy-tracker/shared-spinner-stores]', () => {
  test("'running' transition writes streaming-status, loading atom, and cliBusy", () => {
    const { store } = renderTracker();

    act(() => {
      mockStateSubscriptionCallbacks.onData?.({ paneId: `cli:${SUB}`, state: 'running' });
    });

    expect(useStreamingStatusStore.getState().getStatus(SUB)).toBe('streaming');
    expect(useStreamingStatusStore.getState().isStreaming(SUB)).toBe(true);
    expect(store.get(loadingSubChatsAtom).get(SUB)).toBe(PARENT);
    expect(store.get(cliBusyAtomFamily(SUB))).toBe(true);
  });

  test("'idle' transition clears all three stores", () => {
    const { store } = renderTracker();

    act(() => {
      mockStateSubscriptionCallbacks.onData?.({ paneId: `cli:${SUB}`, state: 'running' });
    });
    act(() => {
      mockStateSubscriptionCallbacks.onData?.({ paneId: `cli:${SUB}`, state: 'idle' });
    });

    expect(useStreamingStatusStore.getState().getStatus(SUB)).toBe('ready');
    expect(useStreamingStatusStore.getState().isStreaming(SUB)).toBe(false);
    expect(store.get(loadingSubChatsAtom).has(SUB)).toBe(false);
    expect(store.get(cliBusyAtomFamily(SUB))).toBe(false);
  });

  test("'idle' ticks both sub-chat and parent-chat 'agent finished' atoms", () => {
    const { store } = renderTracker();

    const subTickBefore = store.get(agentFinishedTickAtomFamily(SUB));
    const chatTickBefore = store.get(agentFinishedTickAtomFamily(PARENT));

    act(() => {
      mockStateSubscriptionCallbacks.onData?.({ paneId: `cli:${SUB}`, state: 'idle' });
    });

    expect(store.get(agentFinishedTickAtomFamily(SUB))).toBe(subTickBefore + 1);
    expect(store.get(agentFinishedTickAtomFamily(PARENT))).toBe(chatTickBefore + 1);
  });

  test('unmount clears stale spinner entries so closed tabs do not leave ghost spinners', () => {
    const { store, unmount } = renderTracker();

    act(() => {
      mockStateSubscriptionCallbacks.onData?.({ paneId: `cli:${SUB}`, state: 'running' });
    });
    expect(useStreamingStatusStore.getState().getStatus(SUB)).toBe('streaming');
    expect(store.get(loadingSubChatsAtom).has(SUB)).toBe(true);

    unmount();

    expect(useStreamingStatusStore.getState().getStatus(SUB)).toBe('ready');
    expect(store.get(loadingSubChatsAtom).has(SUB)).toBe(false);
  });

  test('subscription is disabled when isCliHarness=false (builtin path keeps its own writer)', () => {
    renderTracker({ isCliHarness: false });
    expect(mockStateSubscriptionCallbacks.enabled).toBe(false);
  });
});
