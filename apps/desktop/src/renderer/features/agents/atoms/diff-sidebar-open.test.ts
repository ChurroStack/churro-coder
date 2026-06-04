// @vitest-environment jsdom
/**
 * Regression + documentation: `diffSidebarOpenAtomFamily` read precedence.
 *
 * The getter resolves in this order:
 *   1. an explicit runtime value (user opened/closed it this session) wins;
 *   2. otherwise, on initial load, the persisted value is restored ONLY in
 *      'side-peek' (sidebar) mode — dialog/fullscreen modes start closed;
 *   3. otherwise `false`.
 * The setter always writes BOTH the runtime and the persisted (window-scoped)
 * storage.
 *
 * A prior review flagged a possible stale read when a chat mounts in
 * 'center-peek' and the user later switches to 'side-peek'. Because
 * `diffViewDisplayModeAtom` is a `get()` dependency of this derived atom, jotai
 * recomputes the value on the mode switch — there is no stale read at the atom
 * level. These tests pin that behavior so a future refactor can't regress it.
 *
 * Note: the "restore persisted state only in side-peek on initial load" branch
 * is verified by inspection — `atomWithWindowStorage` captures its value via
 * `getOnInit` at module load, so a unit test cannot re-seed window-scoped
 * localStorage for a fresh store. The branch and its reactivity are covered
 * here through the runtime path instead.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createStore } from 'jotai';
import { diffSidebarOpenAtomFamily, diffViewDisplayModeAtom } from './index';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('diffSidebarOpenAtomFamily — read precedence', () => {
  test('an explicit runtime value wins regardless of display mode', () => {
    const store = createStore();
    const chatId = 'chat-runtime';
    store.set(diffViewDisplayModeAtom, 'center-peek');

    store.set(diffSidebarOpenAtomFamily(chatId), true);
    expect(store.get(diffSidebarOpenAtomFamily(chatId))).toBe(true);

    store.set(diffSidebarOpenAtomFamily(chatId), false);
    expect(store.get(diffSidebarOpenAtomFamily(chatId))).toBe(false);
  });

  test('with no runtime value, a non-side-peek mode reads as closed', () => {
    const store = createStore();
    const chatId = 'chat-initial';
    store.set(diffViewDisplayModeAtom, 'center-peek');
    expect(store.get(diffSidebarOpenAtomFamily(chatId))).toBe(false);
  });

  test('an explicitly opened sidebar is preserved across display-mode switches', () => {
    const store = createStore();
    const chatId = 'chat-toggle';

    // User opens the diff sidebar while in side-peek mode.
    store.set(diffViewDisplayModeAtom, 'side-peek');
    store.set(diffSidebarOpenAtomFamily(chatId), true);
    expect(store.get(diffSidebarOpenAtomFamily(chatId))).toBe(true);

    // Switching display mode must NOT drop the user's explicit open: the
    // runtime value is mode-independent and the derived atom recomputes
    // reactively when the mode atom changes (no stale read).
    store.set(diffViewDisplayModeAtom, 'center-peek');
    expect(store.get(diffSidebarOpenAtomFamily(chatId))).toBe(true);

    store.set(diffViewDisplayModeAtom, 'full-page');
    expect(store.get(diffSidebarOpenAtomFamily(chatId))).toBe(true);
  });
});
