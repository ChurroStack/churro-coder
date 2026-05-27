// @vitest-environment jsdom
/**
 * Unit tests for <CliStateSubscriber/> — the global subscriber that mirrors
 * the main-process `terminal.allCliStates` broadcast into the three renderer
 * stores that drive every CLI working-state affordance.
 *
 * Regression guards (vs. the deleted useCliBusyTracker):
 *  - Does NOT clear state on unmount (the historical band-aid that wiped the
 *    spinner on every dockview tab switch).
 *  - Idempotent writes when snapshot + transition emit the same state.
 *  - Reconnect on onError flips `enabled` false → true via the bumped tick.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import React from 'react';

const mockSub = vi.hoisted(() => ({
  onData: null as
    | ((evt: { subChatId: string; parentChatId: string | null; state: 'running' | 'idle' | 'exited' }) => void)
    | null,
  onError: null as ((err: unknown) => void) | null,
  enabled: undefined as boolean | undefined,
  callCount: 0
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
      allCliStates: {
        useSubscription: vi.fn(
          (
            _input: unknown,
            opts: {
              enabled?: boolean;
              onData?: (evt: {
                subChatId: string;
                parentChatId: string | null;
                state: 'running' | 'idle' | 'exited';
              }) => void;
              onError?: (err: unknown) => void;
            }
          ) => {
            mockSub.callCount += 1;
            mockSub.enabled = opts?.enabled;
            if (opts?.onData) mockSub.onData = opts.onData;
            if (opts?.onError) mockSub.onError = opts.onError;
          }
        )
      }
    }
  }
}));

// appStore singleton — the subscriber writes through it. We swap to a fresh
// per-test store via the JotaiProvider so cliRunningStatesAtom writes land
// where the test reads.
vi.mock('../../../lib/jotai-store', () => {
  const { createStore } = require('jotai');
  return { appStore: createStore() };
});

import { CliStateSubscriber } from './cli-state-subscriber';
import { useStreamingStatusStore } from '../stores/streaming-status-store';
import { loadingSubChatsAtom, cliRunningStatesAtom, agentFinishedTickAtomFamily } from '../atoms';
import { appStore } from '../../../lib/jotai-store';

const SUB = 'sc-cli-1';
const PARENT = 'chat-cli-1';

function renderSubscriber() {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(JotaiProvider, { store: appStore }, children);
  return render(<CliStateSubscriber />, { wrapper });
}

beforeEach(() => {
  mockInvalidate.mockClear();
  mockSub.onData = null;
  mockSub.onError = null;
  mockSub.enabled = undefined;
  mockSub.callCount = 0;
  useStreamingStatusStore.setState({ statuses: {} });
  appStore.set(loadingSubChatsAtom, new Map());
  appStore.set(cliRunningStatesAtom, new Map());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('CliStateSubscriber — mirroring [cli-state-subscriber/mirror]', () => {
  test("'running' writes cliRunningStatesAtom, streaming store, and loadingSubChatsAtom", () => {
    renderSubscriber();
    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'running' });

    const entry = appStore.get(cliRunningStatesAtom).get(SUB);
    expect(entry).toEqual({ state: 'running', parentChatId: PARENT });
    expect(useStreamingStatusStore.getState().getStatus(SUB)).toBe('streaming');
    expect(appStore.get(loadingSubChatsAtom).get(SUB)).toBe(PARENT);
  });

  test("'idle' retains cliRunningStatesAtom entry but clears loadingSubChatsAtom and resets streaming status", () => {
    renderSubscriber();
    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'running' });
    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'idle' });

    const entry = appStore.get(cliRunningStatesAtom).get(SUB);
    expect(entry).toEqual({ state: 'idle', parentChatId: PARENT });
    expect(useStreamingStatusStore.getState().getStatus(SUB)).toBe('ready');
    expect(appStore.get(loadingSubChatsAtom).has(SUB)).toBe(false);
  });

  test("'exited' removes the cliRunningStatesAtom entry entirely", () => {
    renderSubscriber();
    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'running' });
    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'exited' });

    expect(appStore.get(cliRunningStatesAtom).has(SUB)).toBe(false);
    expect(useStreamingStatusStore.getState().getStatus(SUB)).toBe('ready');
    expect(appStore.get(loadingSubChatsAtom).has(SUB)).toBe(false);
  });

  test('cache invalidations fire only on idle/exited, never on running', () => {
    renderSubscriber();

    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'running' });
    expect(mockInvalidate).not.toHaveBeenCalled();

    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'idle' });
    expect(mockInvalidate.mock.calls.length).toBeGreaterThan(0);
  });

  test('idle ticks agentFinishedTickAtomFamily for both sub-chat and parent chat', () => {
    renderSubscriber();
    const subBefore = appStore.get(agentFinishedTickAtomFamily(SUB));
    const parentBefore = appStore.get(agentFinishedTickAtomFamily(PARENT));

    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'idle' });

    expect(appStore.get(agentFinishedTickAtomFamily(SUB))).toBe(subBefore + 1);
    expect(appStore.get(agentFinishedTickAtomFamily(PARENT))).toBe(parentBefore + 1);
  });

  test('null parentChatId still writes cliRunningStatesAtom but skips loadingSubChatsAtom', () => {
    renderSubscriber();
    mockSub.onData?.({ subChatId: SUB, parentChatId: null, state: 'running' });

    expect(appStore.get(cliRunningStatesAtom).get(SUB)).toEqual({
      state: 'running',
      parentChatId: null
    });
    // loadingSubChatsAtom requires a parentChatId to set the Map value, so
    // the entry is skipped — the sidebar can't light up workspace rows
    // without it, but cliBusyAtomFamily still works.
    expect(appStore.get(loadingSubChatsAtom).has(SUB)).toBe(false);
  });

  test('idempotent: repeated identical events do not churn the source map', () => {
    renderSubscriber();
    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'running' });
    const firstRef = appStore.get(cliRunningStatesAtom);
    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'running' });
    const secondRef = appStore.get(cliRunningStatesAtom);
    expect(firstRef).toBe(secondRef);
  });
});

describe('CliStateSubscriber — lifecycle [cli-state-subscriber/lifecycle]', () => {
  test('unmount does NOT clear cliRunningStatesAtom / loadingSubChatsAtom / streaming store', () => {
    const { unmount } = renderSubscriber();
    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'running' });

    expect(appStore.get(cliRunningStatesAtom).has(SUB)).toBe(true);
    expect(appStore.get(loadingSubChatsAtom).has(SUB)).toBe(true);
    expect(useStreamingStatusStore.getState().getStatus(SUB)).toBe('streaming');

    unmount();

    expect(appStore.get(cliRunningStatesAtom).has(SUB)).toBe(true);
    expect(appStore.get(loadingSubChatsAtom).has(SUB)).toBe(true);
    expect(useStreamingStatusStore.getState().getStatus(SUB)).toBe('streaming');
  });

  test('onError triggers reconnect bumps that re-render the subscription hook', async () => {
    const { act } = await import('react');
    renderSubscriber();
    const callsBefore = mockSub.callCount;
    expect(callsBefore).toBeGreaterThan(0);

    // Synchronous bump on error → re-render → useSubscription called again.
    await act(async () => {
      mockSub.onError?.(new Error('IPC link dropped'));
    });
    const callsAfterFirstBump = mockSub.callCount;
    expect(callsAfterFirstBump).toBeGreaterThan(callsBefore);

    // The second bump fires inside a real setTimeout(..., 1000). Wait for it
    // and verify it produced another render.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1100));
    });
    expect(mockSub.callCount).toBeGreaterThan(callsAfterFirstBump);
  });
});
