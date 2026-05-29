// @vitest-environment jsdom
/**
 * Unit tests for <CliStateSubscriber/> — the global subscriber that drives
 * every CLI working-state affordance through the unified `subChatBusyAtom`.
 *
 * Regression guards:
 *  - Does NOT clear state on unmount (the historical band-aid that wiped the
 *    spinner on every dockview tab switch).
 *  - Idempotent writes when snapshot + transition emit the same state.
 *  - `state='running'` with null parentChatId still writes the busy entry
 *    (the previous `parentChatId &&` guard caused the workspace row / dock
 *    tab / kanban card divergence).
 *  - Reconnect on onError flips `enabled` false → true via the bumped tick.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
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

vi.mock('../../../lib/jotai-store', () => {
  const { createStore } = require('jotai');
  return { appStore: createStore() };
});

import { CliStateSubscriber } from './cli-state-subscriber';
import {
  agentFinishedTickAtomFamily,
  cliBusyAtomFamily,
  parentChatBusyAtomFamily,
  subChatBusyAtom,
  subChatBusyAtomFamily
} from '../atoms';
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
  appStore.set(subChatBusyAtom, new Map());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('CliStateSubscriber — unified busy atom [cli-state-subscriber/mirror]', () => {
  test("'running' flips every consumer-visible read path to busy in one tick", () => {
    renderSubscriber();
    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'running' });

    const entry = appStore.get(subChatBusyAtom).get(SUB);
    expect(entry).toEqual({ state: 'running', parentChatId: PARENT, source: 'cli' });
    expect(appStore.get(subChatBusyAtomFamily(SUB))).toBe(true);
    expect(appStore.get(cliBusyAtomFamily(SUB))).toBe(true);
    expect(appStore.get(parentChatBusyAtomFamily(PARENT))).toBe(true);
    expect(entry?.parentChatId).toBe(PARENT);
  });

  test("'idle' deletes the entry — all derived consumers report not busy", () => {
    renderSubscriber();
    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'running' });
    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'idle' });

    expect(appStore.get(subChatBusyAtom).has(SUB)).toBe(false);
    expect(appStore.get(subChatBusyAtomFamily(SUB))).toBe(false);
    expect(appStore.get(parentChatBusyAtomFamily(PARENT))).toBe(false);
  });

  test("'exited' removes the entry from all derived atoms", () => {
    renderSubscriber();
    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'running' });
    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'exited' });

    expect(appStore.get(subChatBusyAtom).has(SUB)).toBe(false);
    expect(appStore.get(subChatBusyAtomFamily(SUB))).toBe(false);
    expect(appStore.get(parentChatBusyAtomFamily(PARENT))).toBe(false);
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

  test('null parentChatId still writes the busy entry — sub-chat-keyed consumers flip on', () => {
    // Regression: the old subscriber had `if (state === 'running' && parentChatId)`,
    // which silently dropped the loading state whenever the cli-state event
    // arrived during a window where session.workspaceId was empty (reattach).
    // Sub-chat-keyed consumers (the sub-chats sidebar plan icon, the dock tab,
    // the workflow notch) MUST still light up.
    renderSubscriber();
    mockSub.onData?.({ subChatId: SUB, parentChatId: null, state: 'running' });

    expect(appStore.get(subChatBusyAtom).get(SUB)).toEqual({
      state: 'running',
      parentChatId: null,
      source: 'cli'
    });
    expect(appStore.get(subChatBusyAtomFamily(SUB))).toBe(true);
    // Parent-keyed consumers correctly skip null-parented entries — they
    // can't attribute the busy state to a specific workspace row, but the
    // sub-chat itself is still visible to other surfaces.
    expect(appStore.get(parentChatBusyAtomFamily(PARENT))).toBe(false);
    // The source map still has the entry (with null parent) so subChat-
    // keyed surfaces (sub-chats sidebar, dock tab, workflow notch) light up.
    expect(appStore.get(subChatBusyAtom).get(SUB)?.parentChatId).toBeNull();
  });

  test('idempotent: repeated identical events do not churn the source map', () => {
    renderSubscriber();
    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'running' });
    const firstRef = appStore.get(subChatBusyAtom);
    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'running' });
    const secondRef = appStore.get(subChatBusyAtom);
    expect(firstRef).toBe(secondRef);
  });
});

describe('CliStateSubscriber — lifecycle [cli-state-subscriber/lifecycle]', () => {
  test('unmount does NOT clear subChatBusyAtom (the disappearing-spinner regression)', () => {
    const { unmount } = renderSubscriber();
    mockSub.onData?.({ subChatId: SUB, parentChatId: PARENT, state: 'running' });

    expect(appStore.get(subChatBusyAtom).has(SUB)).toBe(true);
    expect(appStore.get(subChatBusyAtomFamily(SUB))).toBe(true);

    unmount();

    expect(appStore.get(subChatBusyAtom).has(SUB)).toBe(true);
    expect(appStore.get(subChatBusyAtomFamily(SUB))).toBe(true);
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
