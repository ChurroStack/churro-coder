// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, act } from '@testing-library/react';

type MutationOpts = {
  onSuccess?: (data: unknown, variables: unknown, context: unknown) => void;
  onError?: (err: unknown, variables: unknown, context: unknown) => void;
};

let capturedOpts: MutationOpts | undefined;

vi.mock('./trpc', () => ({
  trpc: {
    chats: {
      updateSubChatMode: {
        useMutation: vi.fn((opts?: MutationOpts) => {
          capturedOpts = opts;
          return {
            mutate: vi.fn(),
            mutateAsync: vi.fn(async () => undefined),
            isPending: false
          };
        })
      }
    }
  },
  trpcClient: {}
}));

import { api } from './mock-api';

afterEach(() => {
  cleanup();
  capturedOpts = undefined;
  vi.clearAllMocks();
});

describe('mock-api updateSubChatMode wrapper', () => {
  /**
   * Regression: the wrapper used to call `opts?.onSuccess?.(data)`,
   * dropping `variables` and `context`. That silently broke
   * `createUpdateSubChatModeOnSuccess` (which reads `variables.subChatId`
   * to invalidate `chats.getSubChat`) and the active-chat error revert
   * (which reads `variables.mode`/`variables.subChatId`). The result was
   * the Approve button doing nothing because the cache invalidation
   * never ran.
   */
  it('forwards data, variables, and context to onSuccess', () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();

    renderHook(() => api.agents.updateSubChatMode.useMutation({ onSuccess, onError }));

    expect(capturedOpts?.onSuccess).toBeTypeOf('function');

    const data = { id: 'sub-1', mode: 'execute' };
    const variables = { id: 'sub-1', mode: 'execute' as const, exitPlan: undefined };
    const context = { previous: 'plan' };

    act(() => {
      capturedOpts!.onSuccess!(data, variables, context);
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(data, variables, context);
  });

  it('forwards err, variables, and context to onError', () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();

    renderHook(() => api.agents.updateSubChatMode.useMutation({ onSuccess, onError }));

    expect(capturedOpts?.onError).toBeTypeOf('function');

    const err = new Error('boom');
    const variables = { id: 'sub-2', mode: 'plan' as const, exitPlan: true };
    const context = { previous: 'execute' };

    act(() => {
      capturedOpts!.onError!(err, variables, context);
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(err, variables, context);
  });
});
