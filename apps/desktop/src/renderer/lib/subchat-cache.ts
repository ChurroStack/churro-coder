/**
 * Per-subChat cache invalidation helpers.
 *
 * The renderer's React Query cache is intentionally not persisted across app
 * sessions (see TRPCProvider.tsx). Within a session, queries keyed by
 * subChatId / worktreePath can become stale when:
 *   - The user switches between two dock panels — the previously-visible
 *     panel's data remains cached past the new mount unless invalidated.
 *   - A CLI session (Claude, Codex) writes a new plan / review / file-changes
 *     manifest via MCP tools — the renderer doesn't observe the write unless
 *     a tRPC subscription or explicit invalidation fires.
 *
 * This module centralizes the list of subChat-scoped query keys so a single
 * call can refresh "everything that depends on subChat X" without each caller
 * having to remember the full set. Callers go through `invalidateSubChatQueries`
 * (recommended on panel activation) or `clearAllRendererCaches` (debug / user-
 * initiated "wipe the cache" action).
 *
 * Keep the list in sync with any new tRPC queries that take `subChatId` as
 * input. If a new query is added without a corresponding entry here, switching
 * back to its panel may show stale data.
 */

import type { QueryClient } from '@tanstack/react-query';
import { getQueryClient } from '../contexts/TRPCProvider';

/** Subchat-scoped tRPC query key prefixes. Each is [[router, procedure]]. */
const SUBCHAT_QUERY_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['chats', 'getMcpFileChanges'],
  ['chats', 'getCurrentPlan'],
  ['chats', 'getCurrentReview'],
  ['chats', 'getCurrentTasks'],
  ['chats', 'getReviewContent']
];

/**
 * Invalidate every subChat-scoped query for `subChatId`. Safe to call on every
 * dock-panel activation — React Query coalesces concurrent invalidations and
 * only refetches the subset that has subscribed observers.
 */
export function invalidateSubChatQueries(subChatId: string, client?: QueryClient): void {
  const qc = client ?? getQueryClient();
  if (!qc) return;
  for (const key of SUBCHAT_QUERY_KEYS) {
    void qc.invalidateQueries({ queryKey: [key, { subChatId }] });
  }
}

/**
 * Drop ALL renderer React Query state and let it rebuild as components remount.
 * Intended for the user-facing "Reset cache" action under Settings → Privacy →
 * Debug. Do NOT call on app startup — the cache is already empty at cold start;
 * clearing it would just delay first paint.
 */
export function clearAllRendererCaches(client?: QueryClient): void {
  const qc = client ?? getQueryClient();
  if (!qc) return;
  qc.clear();
}
