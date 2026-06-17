import { createElement, useCallback, useRef, useState, type ReactNode } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { trpc } from '@/lib/trpc';
import { autoAdvanceTargetAtom } from '@/lib/atoms';
import { previousAgentChatIdAtom, selectedAgentChatIdAtom } from '@/features/agents/atoms';
import { useDockApi } from './dock-context';

/**
 * Archive a whole workspace (the parent chat) behind a confirm dialog, then:
 *   1. refresh the workspace list (`chats.list.invalidate` — without it the
 *      sidebar never re-queries and the archive looks like a no-op),
 *   2. advance the selected workspace to the next one (mirrors the sidebar
 *      archive icon: honours `autoAdvanceTargetAtom` — next / previous / close),
 *   3. close any open `chat:` dock panels.
 *
 * Reversible (no worktree deletion) — restore from the archive popover.
 */
export function useArchiveWorkspace() {
  const dockApi = useDockApi();
  const utils = trpc.useUtils();
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom);
  const selectedChatId = useAtomValue(selectedAgentChatIdAtom);
  const previousChatId = useAtomValue(previousAgentChatIdAtom);
  const autoAdvanceTarget = useAtomValue(autoAdvanceTargetAtom);
  const { data: localChats } = trpc.chats.list.useQuery({});

  const [open, setOpen] = useState(false);
  const pendingChatIdRef = useRef<string | null>(null);

  const archiveChat = trpc.chats.archive.useMutation({
    onSuccess: () => {
      void utils.chats.list.invalidate();
    }
  });

  // Mirror the sidebar's auto-advance: pick the workspace to select after the
  // current one is archived. Uses the still-cached (pre-refetch) list so the
  // just-archived row is still present for index math, same as the sidebar.
  const pickNextSelection = useCallback(
    (archivedId: string): string | null => {
      const sorted = [...(localChats ?? [])].sort(
        (a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0)
      );
      if (autoAdvanceTarget === 'previous') {
        const ok =
          previousChatId &&
          previousChatId !== archivedId &&
          sorted.some((c) => c.id === previousChatId && !c.archivedAt);
        return ok ? previousChatId : null;
      }
      if (autoAdvanceTarget === 'next') {
        const currentIndex = sorted.findIndex((c) => c.id === archivedId);
        const next = sorted.find((c, i) => i > currentIndex && c.id !== archivedId && !c.archivedAt);
        return next?.id ?? null;
      }
      // 'close' → new-workspace view
      return null;
    },
    [localChats, autoAdvanceTarget, previousChatId]
  );

  const archive = useCallback((chatId: string) => {
    pendingChatIdRef.current = chatId;
    setOpen(true);
  }, []);

  const confirm = useCallback(async () => {
    const chatId = pendingChatIdRef.current;
    if (!chatId) {
      setOpen(false);
      return;
    }
    // Compute the next selection BEFORE awaiting (list is still un-refetched).
    const nextSelection = selectedChatId === chatId ? pickNextSelection(chatId) : undefined;
    try {
      await archiveChat.mutateAsync({ id: chatId });
      console.log(`[archive-workspace] archived workspace chatId=${chatId} next=${nextSelection ?? 'none'}`);
      // Advance selection so the UI moves off the archived workspace (only when
      // it was the selected one — don't hijack selection otherwise).
      if (nextSelection !== undefined) {
        setSelectedChatId(nextSelection);
      }
      // Close any open chat panels for the dockview layout (no-op in the
      // sidebar+content layout, where selection drives the view).
      if (dockApi) {
        for (const panel of dockApi.panels) {
          if (panel.id.startsWith('chat:')) panel.api.close();
        }
      }
    } catch (err) {
      console.error(`[archive-workspace] failed to archive chatId=${chatId}:`, err);
      toast.error('Failed to archive workspace');
    } finally {
      setOpen(false);
    }
  }, [archiveChat, dockApi, selectedChatId, pickNextSelection, setSelectedChatId]);

  const isPending = archiveChat.isPending;

  const dialog: ReactNode = createElement(
    AlertDialog,
    { open, onOpenChange: setOpen },
    createElement(
      AlertDialogContent,
      null,
      createElement(
        AlertDialogHeader,
        null,
        createElement(AlertDialogTitle, null, 'Archive this workspace?'),
        createElement(
          AlertDialogDescription,
          null,
          'The workspace moves to your archive and the view advances to your next workspace. Nothing is deleted — you can restore it later from the archive.'
        )
      ),
      createElement(
        AlertDialogFooter,
        null,
        createElement(AlertDialogCancel, { disabled: isPending }, 'Cancel'),
        createElement(
          AlertDialogAction,
          {
            disabled: isPending,
            onClick: (e: React.MouseEvent) => {
              e.preventDefault();
              void confirm();
            }
          },
          isPending ? 'Archiving…' : 'Archive'
        )
      )
    )
  );

  return { archive, isPending, dialog };
}
