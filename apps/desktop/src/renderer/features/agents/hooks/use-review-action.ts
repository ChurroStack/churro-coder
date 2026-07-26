/**
 * `useReviewAction` — single source of truth for "kick off an AI review of
 * the current diff" across the chat-input button and the diff-panel button.
 *
 *   1. Switch the sub-chat to the Review-mode default model + thinking
 *      synchronously (cross-provider safe via applyModeDefaultModelAndSwitchProvider)
 *   2. Seed `pendingReviewMessageAtomFamily(subChatId)` with the native
 *      `/code-review` command, same as the CLI harnesses' dispatchReview()
 *      (see use-harness-send-dispatcher.ts) — the SDK expands slash commands,
 *      so this runs the same built-in skill instead of a bespoke prompt.
 *
 * Pinned to `high` effort: the default/low tier can finish a review without
 * ever producing the richer structured findings a larger diff needs
 * (confirmed empirically against real transcripts — see dispatchReview's
 * comment for detail).
 *
 * The shared `reviewInFlight` Set in `lib/model-switching.ts` already prevents
 * cross-surface double-triggers; this hook just wraps the same flow so the
 * model-switch logic doesn't drift between callers.
 *
 * Navigation (e.g. `activateChatPanelWhenReady` in the diff panel) stays at
 * the call site — those are surface-specific concerns.
 *
 * Note: `/code-review` reviews the working diff directly and its only
 * argument is an effort level, so the Changes panel's Scoped/All file filter
 * (previously honored via `generateReviewMessage`) can no longer be passed
 * through. Surfaced to the user via a toast (see `filteredSubChatIdAtom`
 * check below) rather than silently dropped.
 */

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { filteredSubChatIdAtom, pendingReviewMessageAtomFamily } from '@/features/agents/atoms';
import { appStore } from '@/lib/jotai-store';
import { applyModeDefaultModelAndSwitchProvider, reviewInFlight } from '@/features/agents/lib/model-switching';
import { forceFreshSubChatSessionIfOpenSpec } from '@/features/agents/lib/session-reset';

export interface UseReviewActionOptions {
  /** Sub-chat to run the review against. Hook is a no-op when null. */
  activeSubChatId: string | null | undefined;
}

export function useReviewAction({ activeSubChatId }: UseReviewActionOptions): {
  runReview: () => Promise<{ ok: boolean }>;
  isReviewing: boolean;
} {
  const [isReviewing, setIsReviewing] = useState(false);

  const runReview = useCallback(async (): Promise<{ ok: boolean }> => {
    if (!activeSubChatId) {
      toast.error('No active chat available', { position: 'top-center' });
      return { ok: false };
    }
    if (reviewInFlight.has(activeSubChatId)) return { ok: false };
    reviewInFlight.add(activeSubChatId);

    setIsReviewing(true);
    try {
      // Switch to the configured Review-mode model + thinking synchronously
      // BEFORE any await yields the event loop. Provider switch is safe via
      // the AndSwitchProvider variant — the previous transport is torn down
      // and the next getOrCreateChat recreates under the new provider.
      applyModeDefaultModelAndSwitchProvider(activeSubChatId, 'review');

      forceFreshSubChatSessionIfOpenSpec(activeSubChatId);
      appStore.set(pendingReviewMessageAtomFamily(activeSubChatId), '/code-review high');
      if (appStore.get(filteredSubChatIdAtom)) {
        toast.info('Reviewing the full working diff — the Scoped filter is not applied to /code-review', {
          position: 'top-center'
        });
      }
      return { ok: true };
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start review', { position: 'top-center' });
      return { ok: false };
    } finally {
      setIsReviewing(false);
      reviewInFlight.delete(activeSubChatId);
    }
  }, [activeSubChatId]);

  return { runReview, isReviewing };
}
