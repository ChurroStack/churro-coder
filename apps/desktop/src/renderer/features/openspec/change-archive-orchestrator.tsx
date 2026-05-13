import { useEffect, useMemo, useRef } from 'react';
import type { DockviewApi } from 'dockview-react';
import { useAtomValue, useSetAtom } from 'jotai';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc';
import { useAgentSubChatStore } from '../agents/stores/sub-chat-store';
import { useStreamingStatusStore } from '../agents/stores/streaming-status-store';
import {
  pendingChangeArchiveAtomFamily,
  pendingChangeArchivesByChatAtomFamily,
  type PendingChangeArchive
} from './atoms';

const ARCHIVE_TIMEOUT_MS = 10 * 60 * 1000;

interface ChangeArchiveOrchestratorProps {
  chatId: string | null;
  dockApi: DockviewApi | null;
}

export function ChangeArchiveOrchestrator({ chatId, dockApi }: ChangeArchiveOrchestratorProps) {
  if (!chatId) return null;
  return <ChangeArchiveOrchestratorForChat chatId={chatId} dockApi={dockApi} />;
}

function ChangeArchiveOrchestratorForChat({ chatId, dockApi }: { chatId: string; dockApi: DockviewApi | null }) {
  const pendingByChange = useAtomValue(pendingChangeArchivesByChatAtomFamily(chatId));
  const pendingEntries = useMemo(() => Object.values(pendingByChange), [pendingByChange]);

  return (
    <>
      {pendingEntries.map((pending) => (
        <PendingChangeArchiveObserver key={pending.changeId} pending={pending} dockApi={dockApi} />
      ))}
    </>
  );
}

function PendingChangeArchiveObserver({
  pending,
  dockApi
}: {
  pending: PendingChangeArchive;
  dockApi: DockviewApi | null;
}) {
  const { chatId, subChatId, changeId } = pending;
  const trpcUtils = trpc.useUtils();
  const archiveChat = trpc.chats.archive.useMutation();
  const setPendingArchive = useSetAtom(pendingChangeArchiveAtomFamily(changeId));
  const setPendingArchivesByChat = useSetAtom(pendingChangeArchivesByChatAtomFamily(chatId));
  const wasStreamingRef = useRef(false);
  const completedRef = useRef(false);

  const isStreaming = useStreamingStatusForSubChat(subChatId);
  const { data: change, refetch: refetchChange } = trpc.openspec.readChange.useQuery(
    { chatId, changeId },
    { enabled: !completedRef.current, staleTime: 5_000, retry: false }
  );
  const { data: archivedChanges, refetch: refetchArchivedChanges } = trpc.openspec.listArchivedChanges.useQuery(
    { chatId },
    { enabled: !completedRef.current, staleTime: 5_000, retry: false }
  );
  const { data: chatData } = trpc.chats.get.useQuery(
    { id: chatId },
    { enabled: !completedRef.current, staleTime: 5_000 }
  );

  trpc.openspec.watchChange.useSubscription(
    { chatId, changeId },
    {
      enabled: !completedRef.current,
      onData: () => {
        void trpcUtils.openspec.readChange.invalidate({ chatId, changeId });
        void trpcUtils.openspec.listChanges.invalidate({ chatId });
        void trpcUtils.openspec.listArchivedChanges.invalidate({ chatId });
      },
      onError: (err) => console.warn(`[openspec/archive] watch ended changeId=${changeId}`, err)
    }
  );

  const clearPending = () => {
    setPendingArchive(null);
    setPendingArchivesByChat((prev) => {
      const next = { ...prev };
      delete next[changeId];
      return next;
    });
  };

  useEffect(() => {
    if (completedRef.current) return;
    const timer = window.setTimeout(
      () => {
        if (completedRef.current) return;
        completedRef.current = true;
        clearPending();
        toast.error('Archive did not complete', {
          description: 'The workspace was not archived because the OpenSpec change was not confirmed in the archive.'
        });
        console.warn(`[openspec/archive] timeout chatId=${chatId} changeId=${changeId}`);
      },
      Math.max(0, ARCHIVE_TIMEOUT_MS - (Date.now() - pending.startedAt))
    );

    return () => window.clearTimeout(timer);
    // clearPending intentionally omitted; it changes identity with atom setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, changeId, pending.startedAt]);

  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      void refetchChange();
      void refetchArchivedChanges();
      void trpcUtils.openspec.listChanges.invalidate({ chatId });
      console.log(`[openspec/archive] stream ended; refreshing archive state chatId=${chatId} changeId=${changeId}`);
    }
    wasStreamingRef.current = isStreaming;
  }, [chatId, changeId, isStreaming, refetchArchivedChanges, refetchChange, trpcUtils]);

  useEffect(() => {
    if (completedRef.current) return;
    if (change !== null) return;
    if (!archivedChanges?.some((archived) => archived.changeId === changeId)) return;
    // Wait until the agent has finished streaming so the post-mv steps
    // (commit + push + PR) in archive.j2 have a chance to land before we
    // archive the workspace and close its panels.
    if (isStreaming) return;

    completedRef.current = true;

    void (async () => {
      const activeChanges = await trpcUtils.openspec.listChanges.fetch({ chatId });
      const otherOpenSpecSubChats =
        chatData?.subChats?.filter((subChat) => subChat.openspecChangeId && subChat.openspecChangeId !== changeId) ??
        [];
      const shouldArchiveWorkspace = activeChanges.length === 0 && otherOpenSpecSubChats.length === 0;

      if (shouldArchiveWorkspace) {
        // Belt-and-braces: archive.j2 already commits + pushes in step 6, but if the
        // agent skipped or failed those steps we must NOT archive the workspace — the
        // user's local work would be locked behind an archived workspace until they
        // unarchive it. Surface the pending state instead and leave the workspace open.
        const worktreePath = chatData?.worktreePath ?? null;
        if (worktreePath) {
          try {
            const status = await trpcUtils.changes.getStatus.fetch({ worktreePath });
            const dirty = status.staged.length + status.unstaged.length + status.untracked.length > 0;
            const unpushed = status.hasUpstream && status.pushCount > 0;
            if (dirty || unpushed) {
              closeChangePanels(dockApi, subChatId, changeId);
              dropSubChatForWorkspace(chatId, subChatId);
              const reason = dirty
                ? 'Uncommitted changes remain — commit and push them, then archive the workspace manually.'
                : 'Unpushed commits remain on this branch — push them, then archive the workspace manually.';
              toast.warning('Change archived. Workspace kept open.', { description: reason });
              console.warn(
                `[openspec/archive] workspace archive skipped chatId=${chatId} changeId=${changeId} dirty=${dirty} unpushed=${unpushed} pushCount=${status.pushCount}`
              );
              return;
            }
          } catch (err) {
            // Status probe failed (e.g. worktree gone). Don't silently archive — bail
            // and let the user retry once they've verified the working tree.
            const message = err instanceof Error ? err.message : 'Unknown error';
            closeChangePanels(dockApi, subChatId, changeId);
            dropSubChatForWorkspace(chatId, subChatId);
            toast.warning('Change archived. Workspace kept open.', {
              description: `Could not verify git status before archiving the workspace: ${message}`
            });
            console.warn(`[openspec/archive] git status check failed chatId=${chatId}`, err);
            return;
          }
        }
        await archiveChat.mutateAsync({ id: chatId, deleteWorktree: false });
        closeWorkspacePanels(dockApi);
        dropOpenSubChatsForWorkspace(chatId);
        await Promise.allSettled([
          trpcUtils.chats.get.invalidate({ id: chatId }),
          trpcUtils.chats.list.invalidate(),
          trpcUtils.chats.listArchived.invalidate()
        ]);
        toast.success('Change archived. Workspace archived.');
        console.log(`[openspec/archive] workspace archived chatId=${chatId} changeId=${changeId}`);
      } else {
        closeChangePanels(dockApi, subChatId, changeId);
        dropSubChatForWorkspace(chatId, subChatId);
        toast.success('Change archived.');
        console.log(
          `[openspec/archive] change archived chatId=${chatId} changeId=${changeId} otherSubChats=${otherOpenSpecSubChats.length} activeChanges=${activeChanges.length}`
        );
      }
    })()
      .catch((err) => {
        completedRef.current = false;
        const message = err instanceof Error ? err.message : 'Unknown error';
        toast.error('Failed to finish archive', { description: message });
        console.error(`[openspec/archive] failed chatId=${chatId} changeId=${changeId}`, err);
      })
      .finally(() => {
        if (completedRef.current) clearPending();
      });
    // clearPending intentionally omitted; it changes identity with atom setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveChat, archivedChanges, change, changeId, chatData, chatId, dockApi, isStreaming, subChatId, trpcUtils]);

  return null;
}

function useStreamingStatusForSubChat(subChatId: string) {
  return useStreamingStatusStore((s) => s.isStreaming(subChatId));
}

function closeWorkspacePanels(dockApi: DockviewApi | null) {
  if (!dockApi) return;
  for (const panel of dockApi.panels) {
    if (panel.id.startsWith('chat:') || panel.id.startsWith('openspec-change:')) {
      panel.api.close();
    }
  }
}

function closeChangePanels(dockApi: DockviewApi | null, subChatId: string, changeId: string) {
  if (!dockApi) return;
  for (const panel of dockApi.panels) {
    if (panel.id === `chat:${subChatId}` || panel.id === `openspec-change:${changeId}`) {
      panel.api.close();
    }
  }
}

function dropOpenSubChatsForWorkspace(chatId: string) {
  const store = useAgentSubChatStore.getState();
  if (store.chatId !== chatId) return;
  for (const id of [...store.openSubChatIds]) {
    store.removeFromOpenSubChats(id);
  }
}

function dropSubChatForWorkspace(chatId: string, subChatId: string) {
  const store = useAgentSubChatStore.getState();
  if (store.chatId !== chatId) return;
  store.removeFromOpenSubChats(subChatId);
}
