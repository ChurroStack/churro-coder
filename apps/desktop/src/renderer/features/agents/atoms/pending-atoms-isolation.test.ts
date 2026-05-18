// @vitest-environment jsdom
/**
 * Regression: per-subChat isolation invariant for the pending* atom families.
 *
 * Before this change set, six of these atoms were global singletons carrying
 * `{ subChatId, message }` payloads. Two ChatViewInner mounts in different
 * subChats (split-pane dockview, two CLIs in the same worktree) would race on
 * the same atom: setting A's payload, then B's payload before A's effect
 * drained, would overwrite A — A's action would silently never fire. After
 * the refactor each atom is an `atomFamily(subChatId)` so writes to sub-A's
 * atom cannot be observed by sub-B's mount, and vice versa.
 */

import { describe, expect, test } from 'vitest';
import { createStore } from 'jotai';
import {
  pendingPrMessageAtomFamily,
  pendingReviewMessageAtomFamily,
  pendingFixReviewIssuesAtomFamily,
  pendingConflictResolutionMessageAtomFamily,
  pendingMergeBaseMessageAtomFamily,
  pendingContinueMessageAtomFamily,
  pendingBuildPlanAtomFamily
} from './index';

const A = 'sub-A';
const B = 'sub-B';

const MESSAGE_FAMILIES = [
  { name: 'pendingPrMessageAtomFamily', family: pendingPrMessageAtomFamily },
  { name: 'pendingReviewMessageAtomFamily', family: pendingReviewMessageAtomFamily },
  { name: 'pendingFixReviewIssuesAtomFamily', family: pendingFixReviewIssuesAtomFamily },
  { name: 'pendingConflictResolutionMessageAtomFamily', family: pendingConflictResolutionMessageAtomFamily },
  { name: 'pendingMergeBaseMessageAtomFamily', family: pendingMergeBaseMessageAtomFamily }
] as const;

describe('pending* atom families — per-subChat isolation', () => {
  test.each(MESSAGE_FAMILIES)('$name: setting sub-A does not affect sub-B', ({ family }) => {
    const store = createStore();
    expect(store.get(family(A))).toBeNull();
    expect(store.get(family(B))).toBeNull();

    store.set(family(A), 'message for A');

    expect(store.get(family(A))).toBe('message for A');
    expect(store.get(family(B))).toBeNull();

    store.set(family(B), 'message for B');

    // Sub-A's value is preserved — sub-B's write cannot clobber it.
    expect(store.get(family(A))).toBe('message for A');
    expect(store.get(family(B))).toBe('message for B');
  });

  test('pendingContinueMessageAtomFamily: flips per subChat without cross-talk', () => {
    const store = createStore();
    expect(store.get(pendingContinueMessageAtomFamily(A))).toBe(false);

    store.set(pendingContinueMessageAtomFamily(A), true);

    expect(store.get(pendingContinueMessageAtomFamily(A))).toBe(true);
    expect(store.get(pendingContinueMessageAtomFamily(B))).toBe(false);
  });

  test('pendingBuildPlanAtomFamily: flips per subChat without cross-talk', () => {
    const store = createStore();
    expect(store.get(pendingBuildPlanAtomFamily(A))).toBe(false);

    store.set(pendingBuildPlanAtomFamily(A), true);

    expect(store.get(pendingBuildPlanAtomFamily(A))).toBe(true);
    expect(store.get(pendingBuildPlanAtomFamily(B))).toBe(false);

    // Clearing A's flag also stays scoped.
    store.set(pendingBuildPlanAtomFamily(A), false);
    expect(store.get(pendingBuildPlanAtomFamily(A))).toBe(false);
    expect(store.get(pendingBuildPlanAtomFamily(B))).toBe(false);
  });

  test('family returns identity-stable atoms — same key resolves to the same atom', () => {
    // Defensive: atomFamily should memoize by key. If this regressed (e.g. by
    // wrapping in something that re-creates the atom), every `useSetAtom` /
    // `useAtom` call would get a fresh atom and the consumer's effect would
    // never see the writer's update.
    const a1 = pendingPrMessageAtomFamily(A);
    const a2 = pendingPrMessageAtomFamily(A);
    expect(a1).toBe(a2);

    const b1 = pendingPrMessageAtomFamily(B);
    expect(b1).not.toBe(a1);
  });
});
