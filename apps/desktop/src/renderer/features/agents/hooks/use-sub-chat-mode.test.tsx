// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, act } from '@testing-library/react';

// --- mock state ---
const mockSetData = vi.fn();
const mockInvalidate = vi.fn();

type MutationOpts = {
  onSuccess?: (data: unknown, variables: { id: string; mode: string }) => void;
};

let capturedMutationOpts: MutationOpts | undefined;
let mockQueryData: { id: string; mode: string } | undefined;

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      chats: {
        getSubChat: {
          setData: mockSetData,
          invalidate: mockInvalidate
        }
      }
    }),
    chats: {
      getSubChat: {
        useQuery: vi.fn(() => ({ data: mockQueryData }))
      },
      updateSubChatMode: {
        // Simplification: the mock calls `onSuccess` synchronously inside
        // `mutate`, whereas the real tRPC mutation is fire-and-forget async.
        // The fix under test only relies on `onSuccess` running after the DB
        // write succeeds, so sync is sufficient. If the hook ever switches to
        // `mutateAsync` (or awaits the mutation), revisit this mock.
        useMutation: vi.fn((opts?: MutationOpts) => {
          capturedMutationOpts = opts;
          return {
            mutate: vi.fn((vars: { id: string; mode: string }) => {
              capturedMutationOpts?.onSuccess?.({}, vars);
            })
          };
        })
      }
    }
  }
}));

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

import { useSubChatMode } from './use-sub-chat-mode';

afterEach(cleanup);

describe('useSubChatMode (cache-empty race)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedMutationOpts = undefined;
    mockQueryData = undefined;
  });

  /**
   * Regression: the mutation must register an onSuccess that invalidates the
   * getSubChat query. Without this, a stale query response (resolving after the
   * user clicks the mode dropdown) can pin the dropdown to the previous mode
   * even after the DB write succeeds.
   *
   * RED before fix #2 (no onSuccess on the mutation).
   * GREEN after fix #2 (onSuccess calls invalidate).
   */
  it('mutation onSuccess invalidates getSubChat to prevent stale-mode race', () => {
    renderHook(() => useSubChatMode('sub-1'));

    // The mutation must be registered with an onSuccess callback.
    expect(capturedMutationOpts).toBeDefined();
    expect(capturedMutationOpts?.onSuccess).toBeTypeOf('function');

    // Simulate the mutation succeeding.
    act(() => {
      capturedMutationOpts!.onSuccess!({}, { id: 'sub-1', mode: 'execute' });
    });

    // invalidate must be called so the dropdown re-queries and shows the new mode.
    expect(mockInvalidate).toHaveBeenCalledWith({ id: 'sub-1' });
  });

  /**
   * Full-race scenario: the initial getSubChat fetch resolves with stale 'plan'
   * AFTER the user has already clicked Execute. The post-mutation onSuccess
   * must call invalidate so a refetch can pick up the fresh DB value.
   *
   * We do NOT assert the post-invalidate mode value here, because the mocked
   * `useQuery` does not react to `invalidate` — the assertion would be
   * decorative (it would pass whether or not invalidate fired). A real
   * QueryClient + mock-link variant could close that gap.
   */
  it('calls invalidate via onSuccess after mode update, even when stale query resolves to plan first', () => {
    // 1. Cache empty — mode defaults to 'plan'.
    const { result, rerender } = renderHook(() => useSubChatMode('sub-1'));
    expect(result.current.mode).toBe('plan');

    // 2. User clicks Execute.
    act(() => {
      result.current.setMode('execute');
    });

    // 3. Stale initial DB fetch resolves with 'plan' — simulates the race.
    mockQueryData = { id: 'sub-1', mode: 'plan' };
    rerender();
    expect(result.current.mode).toBe('plan');

    // 4. Mutation onSuccess fires (fix #2): calls invalidate.
    //    Before fix: capturedMutationOpts is undefined → this is a no-op → invalidate not called.
    act(() => {
      capturedMutationOpts?.onSuccess?.({}, { id: 'sub-1', mode: 'execute' });
    });
    expect(mockInvalidate).toHaveBeenCalledWith({ id: 'sub-1' });
  });
});
