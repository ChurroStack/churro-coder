// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── tRPC mock ─────────────────────────────────────────────────────────────────

const mockMutateAsync = vi.fn().mockResolvedValue(undefined);
const mockInvalidate = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    chats: {
      refreshWorkflowCaches: {
        useMutation: () => ({ mutateAsync: mockMutateAsync })
      }
    },
    useUtils: () => ({
      chats: {
        get: { invalidate: mockInvalidate },
        getPrStatus: { invalidate: mockInvalidate },
        getCurrentPlan: { invalidate: mockInvalidate },
        getCurrentReview: { invalidate: mockInvalidate },
        getReviewContent: { invalidate: mockInvalidate }
      },
      changes: {
        getStatus: { invalidate: mockInvalidate }
      }
    })
  }
}));

import { useRefreshWorkflowState } from './use-refresh-workflow-state';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useRefreshWorkflowState [cli-bootstrap/refresh-hook]', () => {
  test('refresh() calls mutateAsync and all 6 invalidations', async () => {
    const { result } = renderHook(() => useRefreshWorkflowState('chat-1'));

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockMutateAsync).toHaveBeenCalledWith({ chatId: 'chat-1' });
    // 6 invalidation calls: get, getStatus, getPrStatus, getCurrentPlan, getCurrentReview, getReviewContent
    expect(mockInvalidate).toHaveBeenCalledTimes(6);
  });

  test('isRefreshing toggles true during refresh and false after', async () => {
    let resolveRefresh!: () => void;
    mockMutateAsync.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      })
    );

    const { result } = renderHook(() => useRefreshWorkflowState('chat-2'));

    expect(result.current.isRefreshing).toBe(false);

    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refresh();
    });

    expect(result.current.isRefreshing).toBe(true);

    await act(async () => {
      resolveRefresh();
      await refreshPromise;
    });

    expect(result.current.isRefreshing).toBe(false);
  });

  test('calling refresh twice with same chatId fires both (no dedup in hook itself)', async () => {
    const { result } = renderHook(() => useRefreshWorkflowState('chat-3'));

    await act(async () => {
      await result.current.refresh();
      await result.current.refresh();
    });

    expect(mockMutateAsync).toHaveBeenCalledTimes(2);
  });
});
