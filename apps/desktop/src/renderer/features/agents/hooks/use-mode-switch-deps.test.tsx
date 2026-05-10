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
import {
  chatModeFsmStateAtomFamily,
  defaultExecuteModeModelAtom,
  defaultPlanModeModelAtom,
  subChatProviderOverridesAtom
} from '../atoms';
import { initialState, noteSendRequested, noteStreamStarted, toggleMode } from '../services/mode-switch-service';
import { useModeSwitchDeps } from './use-mode-switch-deps';

/**
 * L3.5 hook tests for `useModeSwitchDeps`. Exercises the wiring between
 * the hook-built deps and `mode-switch-service.toggleMode`. The pure
 * service-level invariants (call ordering, busy gate, hydration race)
 * live in `mode-switch-service.test.ts` and the L4 integration battery —
 * here we focus on what `useModeSwitchDeps` adds:
 *
 *   - `notifyProviderChange` only fires when `readPreviousProvider`
 *     reports an actual provider change (review fix).
 *   - `notifyProviderChange` is skipped when the FSM rejects a toggle
 *     mid-stream (busy) — the dep should never observe rejected toggles.
 *   - Persist failures are surfaced without losing the prior provider
 *     notification.
 *
 * Atom defaults are stubbed so the test does not rely on the live
 * model-list mapping in `provider-from-model.ts` (a `'gpt-5.5'` rename
 * shouldn't break a hook test).
 */

const CODEX_MODEL = 'gpt-5.5';
const CLAUDE_MODEL = 'sonnet';

describe('useModeSwitchDeps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appStore.set(defaultExecuteModeModelAtom, CLAUDE_MODEL);
    appStore.set(defaultPlanModeModelAtom, CODEX_MODEL);
    // Reset the global override map between tests so previous toggles
    // don't bleed into `readPreviousProvider`.
    appStore.set(subChatProviderOverridesAtom, {});
  });

  it('fires notifyProviderChange when the toggle actually crosses providers', async () => {
    // Pre-condition: chat is currently on claude-code (override set).
    appStore.set(subChatProviderOverridesAtom, { 'mode-deps-cross': 'claude-code' });
    const notifyProviderChange = vi.fn();
    const mutation = { mutateAsync: vi.fn(async () => undefined) };
    const subChatId = 'mode-deps-cross';
    appStore.set(chatModeFsmStateAtomFamily(subChatId), initialState('execute'));

    const { result } = renderHook(() => useModeSwitchDeps(mutation, notifyProviderChange));

    await act(async () => {
      await toggleMode(subChatId, 'plan', result.current);
    });

    // Plan default is the codex model → resolved provider is 'codex' →
    // differs from prior 'claude-code' → notification fires.
    expect(notifyProviderChange).toHaveBeenCalledWith(subChatId, 'codex');
    expect(notifyProviderChange).toHaveBeenCalledTimes(1);
    expect(mutation.mutateAsync).toHaveBeenCalledWith({ subChatId, mode: 'plan' });
  });

  it('does NOT fire notifyProviderChange when the toggle stays on the same provider', async () => {
    // Both Plan and Execute defaults are claude-code models → same-provider
    // toggle → no transport recreation needed.
    appStore.set(defaultPlanModeModelAtom, CLAUDE_MODEL);
    appStore.set(subChatProviderOverridesAtom, { 'mode-deps-same': 'claude-code' });
    const notifyProviderChange = vi.fn();
    const mutation = { mutateAsync: vi.fn(async () => undefined) };
    const subChatId = 'mode-deps-same';
    appStore.set(chatModeFsmStateAtomFamily(subChatId), initialState('execute'));

    const { result } = renderHook(() => useModeSwitchDeps(mutation, notifyProviderChange));

    await act(async () => {
      const r = await toggleMode(subChatId, 'plan', result.current);
      expect(r.ok).toBe(true);
      expect(r.crossProvider).toBe(false);
    });

    expect(notifyProviderChange).not.toHaveBeenCalled();
    // The mode persist still fires — same-provider doesn't mean no DB write.
    expect(mutation.mutateAsync).toHaveBeenCalledWith({ subChatId, mode: 'plan' });
  });

  it('toggle still succeeds when notifyProviderChange is undefined', async () => {
    // Legacy/optional contract: the dep is omittable. Toggle commits and
    // persistMode fires; nothing should NPE on the missing callback.
    const mutation = { mutateAsync: vi.fn(async () => undefined) };
    const subChatId = 'mode-deps-no-notify';
    appStore.set(chatModeFsmStateAtomFamily(subChatId), initialState('execute'));

    const { result } = renderHook(() => useModeSwitchDeps(mutation));

    let toggleResult: Awaited<ReturnType<typeof toggleMode>> | undefined;
    await act(async () => {
      toggleResult = await toggleMode(subChatId, 'plan', result.current);
    });

    expect(toggleResult?.ok).toBe(true);
    expect(toggleResult?.crossProvider).toBe(false);
    expect(mutation.mutateAsync).toHaveBeenCalledWith({ subChatId, mode: 'plan' });
  });

  it('busy gate: notifyProviderChange is not called when the FSM rejects a mid-stream toggle', async () => {
    appStore.set(subChatProviderOverridesAtom, { 'mode-deps-busy': 'claude-code' });
    const notifyProviderChange = vi.fn();
    const mutation = { mutateAsync: vi.fn(async () => undefined) };
    const subChatId = 'mode-deps-busy';
    appStore.set(chatModeFsmStateAtomFamily(subChatId), initialState('execute'));

    const { result } = renderHook(() => useModeSwitchDeps(mutation, notifyProviderChange));

    // Drive the FSM into 'streaming' so the toggle is rejected as busy.
    await act(async () => {
      noteSendRequested(subChatId, result.current);
      noteStreamStarted(subChatId, result.current);
    });

    let toggleResult: Awaited<ReturnType<typeof toggleMode>> | undefined;
    await act(async () => {
      toggleResult = await toggleMode(subChatId, 'plan', result.current);
    });

    expect(toggleResult?.ok).toBe(false);
    expect(toggleResult?.reason).toBe('busy');
    expect(notifyProviderChange).not.toHaveBeenCalled();
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it('persist-failed: notifyProviderChange still fires (it runs before the await on persistMode)', async () => {
    // Invariant: provider notification is part of the synchronous PR #36
    // pre-await block, so a later DB persist failure must not roll it back.
    appStore.set(subChatProviderOverridesAtom, { 'mode-deps-persist-failed': 'claude-code' });
    const notifyProviderChange = vi.fn();
    const mutation = {
      mutateAsync: vi.fn(async () => {
        throw new Error('offline');
      })
    };
    const subChatId = 'mode-deps-persist-failed';
    appStore.set(chatModeFsmStateAtomFamily(subChatId), initialState('execute'));

    const { result } = renderHook(() => useModeSwitchDeps(mutation, notifyProviderChange));

    let toggleResult: Awaited<ReturnType<typeof toggleMode>> | undefined;
    await act(async () => {
      toggleResult = await toggleMode(subChatId, 'plan', result.current);
    });

    expect(toggleResult?.ok).toBe(false);
    expect(toggleResult?.reason).toBe('persist-failed');
    // Notification fired BEFORE the await, so the failure can't unwind it.
    expect(notifyProviderChange).toHaveBeenCalledWith(subChatId, 'codex');
  });
});
