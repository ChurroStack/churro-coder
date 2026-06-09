import { useCallback, useState } from 'react';
import { trpc } from '../../../lib/trpc';

export function useRefreshWorkflowState(chatId: string, activeSubChatId?: string | null) {
  const utils = trpc.useUtils();
  const refreshCachesMutation = trpc.chats.refreshWorkflowCaches.useMutation();
  // CLI-session helpers (used only when activeSubChatId is a CLI sub-chat —
  // gated server-side: relocate / reingest no-op on builtin harnesses).
  const cliRelocate = trpc.cliSession.relocate.useMutation();
  const cliReingest = trpc.cliSession.reingest.useMutation();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // 1) Re-run the workflow caches (plan/review/PR/changes) as before.
      await refreshCachesMutation.mutateAsync({ chatId });

      // 2) For CLI sub-chats, also pull fresh data from the on-disk JSONL.
      //    full: true so a user-triggered refresh recovers artifacts whose
      //    bytes were already consumed by a prior mapping-table version
      //    (e.g. ExitPlanMode plans persisted before plan side-effect was
      //    wired). Fill-gaps semantics in ensurePlanWritten make this
      //    idempotent. Best-effort: failures are non-fatal.
      if (activeSubChatId) {
        try {
          await cliRelocate.mutateAsync({ subChatId: activeSubChatId });
          await cliReingest.mutateAsync({ subChatId: activeSubChatId, full: true });
        } catch (err) {
          console.warn('[refresh-workflow-state] cli reingest failed', err);
        }
      }

      await Promise.allSettled([
        utils.chats.get.invalidate({ id: chatId }),
        utils.changes.getStatus.invalidate(),
        utils.chats.getPrStatus.invalidate(),
        utils.chats.getCurrentPlan.invalidate(),
        utils.chats.getCurrentReview.invalidate(),
        utils.chats.getReviewContent.invalidate(),
        // Tasks + file-changes were previously omitted, so the refresh button
        // never re-read them even when the data existed on disk.
        utils.chats.getCurrentTasks.invalidate(),
        utils.chats.getMcpFileChanges.invalidate(),
        ...(activeSubChatId
          ? [
              utils.cliSession.getStatus.invalidate({ subChatId: activeSubChatId }),
              utils.messages.getLatest.invalidate({ subChatId: activeSubChatId, limit: 200 })
            ]
          : [])
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshCachesMutation, cliRelocate, cliReingest, utils, chatId, activeSubChatId]);

  return { refresh, isRefreshing };
}
