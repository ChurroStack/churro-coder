// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── tRPC mock ─────────────────────────────────────────────────────────────────

const mockMutateAsync = vi.fn().mockResolvedValue(undefined);
const mockInvalidate = vi.fn().mockResolvedValue(undefined);
// Dedicated spies for the previously-missing invalidations so the test can
// assert each is now wired (these used to silently never fire).
const mockInvalidateTasks = vi.fn().mockResolvedValue(undefined);
const mockInvalidateFileChanges = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    chats: {
      refreshWorkflowCaches: {
        useMutation: () => ({ mutateAsync: mockMutateAsync })
      }
    },
    cliSession: {
      relocate: { useMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }) },
      reingest: { useMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }) }
    },
    useUtils: () => ({
      chats: {
        get: { invalidate: mockInvalidate },
        getPrStatus: { invalidate: mockInvalidate },
        getCurrentPlan: { invalidate: mockInvalidate },
        getCurrentReview: { invalidate: mockInvalidate },
        getReviewContent: { invalidate: mockInvalidate },
        getCurrentTasks: { invalidate: mockInvalidateTasks },
        getMcpFileChanges: { invalidate: mockInvalidateFileChanges }
      },
      changes: {
        getStatus: { invalidate: mockInvalidate }
      },
      cliSession: {
        getStatus: { invalidate: mockInvalidate }
      },
      messages: {
        getLatest: { invalidate: mockInvalidate }
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
    // 6 shared invalidations: get, getStatus, getPrStatus, getCurrentPlan, getCurrentReview, getReviewContent
    expect(mockInvalidate).toHaveBeenCalledTimes(6);
  });

  test('refresh() also invalidates tasks and file-changes (previously omitted)', async () => {
    const { result } = renderHook(() => useRefreshWorkflowState('chat-tasks'));

    await act(async () => {
      await result.current.refresh();
    });

    // These were never invalidated before the fix, so the refresh button could
    // not surface tasks / file-changes even when the data existed on disk.
    expect(mockInvalidateTasks).toHaveBeenCalledTimes(1);
    expect(mockInvalidateFileChanges).toHaveBeenCalledTimes(1);
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
