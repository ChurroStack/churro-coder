import { useMemo } from 'react';
import { trpc } from '@/lib/trpc';

export interface PendingPlanApprovalIds {
  /** Sub-chats whose plan is awaiting approval (per-tab consumers). */
  subChatIds: Set<string>;
  /** Parent chats (workspaces) with at least one pending plan (sidebar/kanban dots). */
  chatIds: Set<string>;
}

const EMPTY: PendingPlanApprovalIds = { subChatIds: new Set(), chatIds: new Set() };

/**
 * Pure projection of `getPendingPlanApprovals` rows into the two id sets the UI
 * consumes. Extracted so it can be unit-tested without a tRPC/react-query
 * harness. Returns the shared `EMPTY` (stable reference) when there are no rows.
 */
export function deriveApprovalIdSets(
  rows: ReadonlyArray<{ subChatId: string; chatId: string }> | undefined
): PendingPlanApprovalIds {
  if (!rows || rows.length === 0) return EMPTY;
  const subChatIds = new Set<string>();
  const chatIds = new Set<string>();
  for (const { subChatId, chatId } of rows) {
    subChatIds.add(subChatId);
    chatIds.add(chatId);
  }
  return { subChatIds, chatIds };
}

/**
 * Single source of truth for the "pending plan approval" (amber) status.
 *
 * Reads `chats.getPendingPlanApprovals` — the DB-derived list whose detection
 * logic is kept in lock-step with `active-chat.tsx`'s `hasUnapprovedPlan`
 * (see the comment on the procedure in `trpc/routers/chats.ts`). The procedure
 * returns BOTH ids per row, so the same query feeds the per-sub-chat tab glyph
 * / tab-promotion AND the per-workspace sidebar/kanban dots without a second
 * store to drift against.
 *
 * Every caller passing the same `openSubChatIds` shares one react-query fetch
 * (the ids are sorted so call-order can't fork the cache key). Instant updates
 * on the active chat come from `active-chat.tsx` invalidating this query the
 * moment `hasUnapprovedPlan` flips; the 5s `refetchInterval` is the backstop
 * for background sub-chats with no mounted view.
 *
 * Replaces the former `pendingPlanApprovalsAtom`, which was a second,
 * independently-written copy of this fact (mounted-chat only) that drifted from
 * the query depending on which surface read which source.
 */
export function usePendingPlanApprovals(openSubChatIds: string[]): PendingPlanApprovalIds {
  // Sort for a stable, order-independent query key so sibling consumers (e.g.
  // one `useSubChatNeedsInput` per dock tab) dedupe to a single fetch.
  const sortedIds = useMemo(() => [...openSubChatIds].sort(), [openSubChatIds]);

  const { data } = trpc.chats.getPendingPlanApprovals.useQuery(
    { openSubChatIds: sortedIds },
    { refetchInterval: 5000, enabled: sortedIds.length > 0, placeholderData: (prev) => prev }
  );

  // When there are no open sub-chats the query is disabled but react-query keeps
  // the last `data` (and re-supplies it via placeholderData) — so derive EMPTY
  // directly instead of returning stale sets for sub-chats that are now closed.
  return useMemo(
    () => (sortedIds.length === 0 ? deriveApprovalIdSets(undefined) : deriveApprovalIdSets(data)),
    [data, sortedIds]
  );
}
