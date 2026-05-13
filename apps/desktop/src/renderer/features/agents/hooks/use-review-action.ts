/**
 * `useReviewAction` — single source of truth for "kick off an AI review of
 * the current diff" across the chat-input button and the diff-panel button.
 *
 * Both surfaces previously had near-identical 30-line copies of the flow:
 *   1. Switch the sub-chat to the Review-mode default model + thinking
 *      synchronously (cross-provider safe via applyModeDefaultModelAndSwitchProvider)
 *   2. Fetch PR context from the backend
 *   3. Honor the Scoped/All filter from the changes panel
 *   4. Render the review prompt and seed `pendingReviewMessageAtom`
 *
 * The shared `reviewInFlight` Set in `lib/model-switching.ts` already prevents
 * cross-surface double-triggers; this hook just wraps the same flow so the
 * model-switch + prompt logic doesn't drift between callers.
 *
 * Navigation (e.g. `activateChatPanelWhenReady` in the diff panel) stays at
 * the call site — those are surface-specific concerns.
 */

import { useCallback, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { toast } from 'sonner';
import { trpcClient } from '@/lib/trpc';
import { filteredSubChatIdAtom, pendingReviewMessageAtom, subChatFilesAtom } from '@/features/agents/atoms';
import { applyModeDefaultModelAndSwitchProvider, reviewInFlight } from '@/features/agents/lib/model-switching';
import { forceFreshSubChatSessionIfOpenSpec } from '@/features/agents/lib/session-reset';
import { generateReviewMessage } from '@/features/agents/utils/pr-message';

export interface UseReviewActionOptions {
  /** Sub-chat to run the review against. Hook is a no-op when null. */
  activeSubChatId: string | null | undefined;
  /** Workspace chat id (used to fetch PR context). */
  chatId: string | null | undefined;
}

export function useReviewAction({ activeSubChatId, chatId }: UseReviewActionOptions): {
  runReview: () => Promise<{ ok: boolean }>;
  isReviewing: boolean;
} {
  const [isReviewing, setIsReviewing] = useState(false);
  const setPendingReviewMessage = useSetAtom(pendingReviewMessageAtom);
  const filteredSubChatIdValue = useAtomValue(filteredSubChatIdAtom);
  const subChatFiles = useAtomValue(subChatFilesAtom);

  const runReview = useCallback(async (): Promise<{ ok: boolean }> => {
    if (!chatId) {
      toast.error('Chat ID is required', { position: 'top-center' });
      return { ok: false };
    }
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

      const context = await trpcClient.chats.getPrContext.query({ chatId });
      if (!context) {
        toast.error('Could not get git context', { position: 'top-center' });
        return { ok: false };
      }

      // Honor the Scoped/All toggle in the Changes panel: when a sub-chat
      // filter is active, narrow the diff to that sub-chat's files.
      const scopedFiles = filteredSubChatIdValue
        ? (subChatFiles.get(filteredSubChatIdValue) ?? [])
            .map((f) => f.displayPath || f.filePath)
            .filter((p): p is string => !!p)
        : [];

      const message = generateReviewMessage(context, scopedFiles.length > 0 ? scopedFiles : undefined);
      forceFreshSubChatSessionIfOpenSpec(activeSubChatId);
      setPendingReviewMessage({ message, subChatId: activeSubChatId });
      return { ok: true };
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start review', { position: 'top-center' });
      return { ok: false };
    } finally {
      setIsReviewing(false);
      reviewInFlight.delete(activeSubChatId);
    }
  }, [chatId, activeSubChatId, filteredSubChatIdValue, subChatFiles, setPendingReviewMessage]);

  return { runReview, isReviewing };
}
