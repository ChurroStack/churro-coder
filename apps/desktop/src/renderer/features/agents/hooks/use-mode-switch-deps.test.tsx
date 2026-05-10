// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      chats: {
        getSubChat: {
          setData: vi.fn()
        }
      }
    })
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

import { act, renderHook } from '@testing-library/react';
import { appStore } from '../../../lib/jotai-store';
import { chatModeFsmStateAtomFamily, defaultExecuteModeModelAtom, defaultPlanModeModelAtom } from '../atoms';
import { initialState, toggleMode } from '../services/mode-switch-service';
import { useModeSwitchDeps } from './use-mode-switch-deps';

describe('useModeSwitchDeps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appStore.set(defaultExecuteModeModelAtom, 'sonnet');
    appStore.set(defaultPlanModeModelAtom, 'gpt-5.5');
  });

  it('notifies provider changes for user toggles that cross providers', async () => {
    const notifyProviderChange = vi.fn();
    const mutation = {
      mutateAsync: vi.fn(async () => undefined)
    };
    const subChatId = 'mode-deps-cross-provider';
    appStore.set(chatModeFsmStateAtomFamily(subChatId), initialState('execute'));

    const { result } = renderHook(() => useModeSwitchDeps(mutation, notifyProviderChange));

    await act(async () => {
      await toggleMode(subChatId, 'plan', result.current);
    });

    expect(notifyProviderChange).toHaveBeenCalledWith(subChatId, 'codex');
    expect(mutation.mutateAsync).toHaveBeenCalledWith({
      subChatId,
      mode: 'plan'
    });
  });
});
