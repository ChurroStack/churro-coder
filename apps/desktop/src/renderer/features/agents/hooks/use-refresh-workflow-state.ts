import { useCallback, useState } from 'react';
import { trpc } from '../../../lib/trpc';

export function useRefreshWorkflowState(chatId: string) {
  const utils = trpc.useUtils();
  const refreshCachesMutation = trpc.chats.refreshWorkflowCaches.useMutation();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refreshCachesMutation.mutateAsync({ chatId });
      await Promise.allSettled([
        utils.chats.get.invalidate({ id: chatId }),
        utils.changes.getStatus.invalidate(),
        utils.chats.getPrStatus.invalidate(),
        utils.chats.getCurrentPlan.invalidate(),
        utils.chats.getCurrentReview.invalidate(),
        utils.chats.getReviewContent.invalidate()
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshCachesMutation, utils, chatId]);

  return { refresh, isRefreshing };
}
