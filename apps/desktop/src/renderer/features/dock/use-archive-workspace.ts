import { useCallback } from 'react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { useDockApi } from './dock-context';

/**
 * Archive a whole workspace (the parent chat) and close its open chat panels.
 *
 * Reuses the same archive + panel-close sequence as the last-chat path in
 * `ChatTabArchiveHost` (`chat-tab-archive.tsx`): closing a `chat:` panel fires
 * `DockShell.onDidRemovePanel`, which drops it from `openSubChatIds` — so the
 * store stays in sync without ad-hoc bookkeeping. Reversible (no worktree
 * deletion); the workspace can be restored from the archive popover.
 */
export function useArchiveWorkspace() {
  const dockApi = useDockApi();
  const archiveChat = trpc.chats.archive.useMutation();

  const archive = useCallback(
    (chatId: string) => {
      archiveChat
        .mutateAsync({ id: chatId })
        .then(() => {
          if (dockApi) {
            for (const panel of dockApi.panels) {
              if (panel.id.startsWith('chat:')) panel.api.close();
            }
          }
        })
        .catch((err) => {
          console.error('[archive] Failed to archive workspace:', err);
          toast.error('Failed to archive workspace');
        });
    },
    [archiveChat, dockApi]
  );

  return { archive, isPending: archiveChat.isPending };
}
