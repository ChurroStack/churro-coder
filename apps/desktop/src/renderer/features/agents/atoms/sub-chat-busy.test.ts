// @vitest-environment jsdom
/**
 * Cross-surface regression contract for the unified sub-chat busy state.
 *
 * This is the single test that would have caught BOTH the PR #165 gap and the
 * kanban precedence bug at the same time. A single write to `subChatBusyAtom`
 * MUST flip every consumer-visible derived atom in the same tick:
 *   - subChatBusyAtomFamily(subChatId)           → dock tab icon, workflow notch
 *   - cliBusyAtomFamily(subChatId)               → workflow notch (CLI alias)
 *   - parentChatBusyAtomFamily(parentChatId)     → sidebar workspace row,
 *                                                  project group header,
 *                                                  kanban card fallback
 *   - busySubChatsByParentAtomFamily(parentId)   → kanban card primary signal
 *   - loadingSubChatsAtom (derived projection)   → legacy quick-switch / mobile
 *
 * Anything missing from this propagation will surface as drift between
 * surfaces. A new consumer that needs busy state SHOULD add itself to the
 * appropriate derived family, NOT introduce a parallel store.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { createStore } from 'jotai';
import {
  busySubChatsByParentAtomFamily,
  cliBusyAtomFamily,
  clearSubChatBusy,
  parentChatBusyAtomFamily,
  setSubChatBusy,
  subChatBusyAtom,
  subChatBusyAtomFamily,
  subChatCliTurnActiveAtomFamily,
  subChatErrorAtom,
  subChatErrorAtomFamily,
  type SubChatBusyEntry
} from './index';

const SUB_A = 'sc-A';
const SUB_B = 'sc-B';
const PARENT = 'chat-1';
const OTHER_PARENT = 'chat-2';

describe('subChatBusyAtom — cross-surface propagation contract', () => {
  // NOTE: `subChatBusyAtomFamily`, `parentChatBusyAtomFamily`, and
  // `busySubChatsByParentAtomFamily` are global-scope (atomFamily memoizes the
  // derived atom by key). The atom INSTANCE is reused across tests in this
  // module, but each test gets its own `store` via `beforeEach`, so values
  // are isolated. If a future test forgets the `subChatBusyAtom` reset,
  // entries leak; call `…AtomFamily.remove(key)` if true isolation is needed.
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
    store.set(subChatBusyAtom, new Map());
    store.set(subChatErrorAtom, new Set());
  });

  test('one set() write flips every consumer-visible derived atom in the same tick', () => {
    const entry: SubChatBusyEntry = { state: 'running', parentChatId: PARENT, source: 'cli' };
    setSubChatBusy((fn) => store.set(subChatBusyAtom, fn), SUB_A, entry);

    expect(store.get(subChatBusyAtomFamily(SUB_A))).toBe(true);
    expect(store.get(cliBusyAtomFamily(SUB_A))).toBe(true);
    expect(store.get(parentChatBusyAtomFamily(PARENT))).toBe(true);
    expect(store.get(busySubChatsByParentAtomFamily(PARENT))).toEqual(new Set([SUB_A]));
    expect(store.get(subChatBusyAtom).get(SUB_A)?.parentChatId).toBe(PARENT);
  });

  test('clear() drops every derived signal back to idle in the same tick', () => {
    setSubChatBusy((fn) => store.set(subChatBusyAtom, fn), SUB_A, {
      state: 'running',
      parentChatId: PARENT,
      source: 'cli'
    });
    clearSubChatBusy((fn) => store.set(subChatBusyAtom, fn), SUB_A);

    expect(store.get(subChatBusyAtomFamily(SUB_A))).toBe(false);
    expect(store.get(cliBusyAtomFamily(SUB_A))).toBe(false);
    expect(store.get(parentChatBusyAtomFamily(PARENT))).toBe(false);
    expect(store.get(busySubChatsByParentAtomFamily(PARENT))).toEqual(new Set());
    expect(store.get(subChatBusyAtom).has(SUB_A)).toBe(false);
  });

  test('null parentChatId entry: subChat-keyed families still flip, parent-keyed families stay quiet', () => {
    // Regression: the previous subscriber dropped the loading entry whenever
    // parentChatId was momentarily null (CLI session.workspaceId empty during
    // reattach). The unified atom now stores the entry — sub-chat-keyed
    // consumers (dock tab, sub-chat sidebar) flip on; parent-keyed consumers
    // (workspace row, kanban card) can't attribute it to a workspace and
    // correctly skip it.
    setSubChatBusy((fn) => store.set(subChatBusyAtom, fn), SUB_A, {
      state: 'running',
      parentChatId: null,
      source: 'cli'
    });

    expect(store.get(subChatBusyAtomFamily(SUB_A))).toBe(true);
    expect(store.get(cliBusyAtomFamily(SUB_A))).toBe(true);
    expect(store.get(parentChatBusyAtomFamily(PARENT))).toBe(false);
    expect(store.get(busySubChatsByParentAtomFamily(PARENT))).toEqual(new Set());
    // The source map records the null parent — parent-keyed consumers above
    // correctly skip it.
    expect(store.get(subChatBusyAtom).get(SUB_A)?.parentChatId).toBeNull();
  });

  test('two sub-chats under same parent: parent-keyed families aggregate correctly', () => {
    setSubChatBusy((fn) => store.set(subChatBusyAtom, fn), SUB_A, {
      state: 'running',
      parentChatId: PARENT,
      source: 'cli'
    });
    setSubChatBusy((fn) => store.set(subChatBusyAtom, fn), SUB_B, {
      state: 'submitted',
      parentChatId: PARENT,
      source: 'builtin'
    });

    expect(store.get(parentChatBusyAtomFamily(PARENT))).toBe(true);
    expect(store.get(busySubChatsByParentAtomFamily(PARENT))).toEqual(new Set([SUB_A, SUB_B]));

    // Clearing one keeps the parent busy via the other.
    clearSubChatBusy((fn) => store.set(subChatBusyAtom, fn), SUB_A);
    expect(store.get(parentChatBusyAtomFamily(PARENT))).toBe(true);
    expect(store.get(busySubChatsByParentAtomFamily(PARENT))).toEqual(new Set([SUB_B]));

    clearSubChatBusy((fn) => store.set(subChatBusyAtom, fn), SUB_B);
    expect(store.get(parentChatBusyAtomFamily(PARENT))).toBe(false);
    expect(store.get(busySubChatsByParentAtomFamily(PARENT))).toEqual(new Set());
  });

  test('parentChatBusyAtomFamily only matches the requested parent', () => {
    setSubChatBusy((fn) => store.set(subChatBusyAtom, fn), SUB_A, {
      state: 'running',
      parentChatId: PARENT,
      source: 'cli'
    });
    expect(store.get(parentChatBusyAtomFamily(PARENT))).toBe(true);
    expect(store.get(parentChatBusyAtomFamily(OTHER_PARENT))).toBe(false);
    expect(store.get(parentChatBusyAtomFamily(''))).toBe(false);
  });

  test('idempotent: setting the same entry twice does not produce a new Map reference', () => {
    const entry: SubChatBusyEntry = { state: 'running', parentChatId: PARENT, source: 'cli' };
    setSubChatBusy((fn) => store.set(subChatBusyAtom, fn), SUB_A, entry);
    const firstRef = store.get(subChatBusyAtom);
    setSubChatBusy((fn) => store.set(subChatBusyAtom, fn), SUB_A, entry);
    const secondRef = store.get(subChatBusyAtom);
    expect(firstRef).toBe(secondRef);
  });

  test('error atom family is independent of busy state', () => {
    expect(store.get(subChatErrorAtomFamily(SUB_A))).toBe(false);
    store.set(subChatErrorAtom, new Set([SUB_A]));
    expect(store.get(subChatErrorAtomFamily(SUB_A))).toBe(true);
    expect(store.get(subChatBusyAtomFamily(SUB_A))).toBe(false); // not also busy
  });
});

describe('subChatCliTurnActiveAtomFamily — CLI-scoped turn-active (drives non-last-message running vs interrupted)', () => {
  // The read-only CLI transcript feeds in-flight tools in NON-last messages a
  // 'turn-active' status (→ "running", not "interrupted") only when the sub-chat
  // is in an active CLI turn. This family is `true` ONLY for `source: 'cli'` — so
  // a builtin turn (also tracked in subChatBusyAtom) never flips builtin messages.
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
    store.set(subChatBusyAtom, new Map());
    store.set(subChatErrorAtom, new Set());
  });

  test('true when the sub-chat is busy with a CLI turn (source: "cli")', () => {
    setSubChatBusy((fn) => store.set(subChatBusyAtom, fn), SUB_A, {
      state: 'running',
      parentChatId: PARENT,
      source: 'cli'
    });
    expect(store.get(subChatCliTurnActiveAtomFamily(SUB_A))).toBe(true);
  });

  test('false for a builtin turn (source: "builtin") — guards builtin no-regression', () => {
    setSubChatBusy((fn) => store.set(subChatBusyAtom, fn), SUB_B, {
      state: 'running',
      parentChatId: PARENT,
      source: 'builtin'
    });
    // The generic busy family sees it; the CLI-scoped one does not.
    expect(store.get(subChatBusyAtomFamily(SUB_B))).toBe(true);
    expect(store.get(subChatCliTurnActiveAtomFamily(SUB_B))).toBe(false);
  });

  test('false when idle (no entry) and for an empty id', () => {
    expect(store.get(subChatCliTurnActiveAtomFamily(SUB_A))).toBe(false);
    expect(store.get(subChatCliTurnActiveAtomFamily(''))).toBe(false);
  });

  test('flips back to false when the CLI turn clears', () => {
    setSubChatBusy((fn) => store.set(subChatBusyAtom, fn), SUB_A, {
      state: 'running',
      parentChatId: PARENT,
      source: 'cli'
    });
    expect(store.get(subChatCliTurnActiveAtomFamily(SUB_A))).toBe(true);
    clearSubChatBusy((fn) => store.set(subChatBusyAtom, fn), SUB_A);
    expect(store.get(subChatCliTurnActiveAtomFamily(SUB_A))).toBe(false);
  });
});
