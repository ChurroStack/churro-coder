import { useEffect, useMemo, useRef } from 'react';
import type { DockviewApi } from 'dockview-react';
import { useAtomValue, useSetAtom } from 'jotai';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc';
import type { GitChangesStatus } from '../../../shared/changes-types';
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
  const commitAll = trpc.changes.commitAll.useMutation();
  const pushChanges = trpc.changes.push.useMutation();
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
        // Invariant: a workspace cannot be archived (and its panels cannot be
        // closed) while uncommitted or unpushed work remains. archive.j2 already
        // commits + pushes in step 6, but if the agent skipped or failed those
        // steps we attempt to commit + push ourselves. If that fails we keep the
        // openspec change panel open and surface the error so the user can act.
        const worktreePath = chatData?.worktreePath ?? null;
        if (worktreePath) {
          const sync = await syncWorktreeForArchive({
            worktreePath,
            changeId,
            chatId,
            commitAll,
            pushChanges,
            getStatus: () => trpcUtils.changes.getStatus.fetch({ worktreePath })
          });
          if (!sync.ok) {
            // Do NOT close panels, do NOT archive the workspace. Clear pending
            // so the user can retry archiving once they've resolved the issue.
            completedRef.current = false;
            clearPending();
            toast.error('Workspace archive blocked', { description: sync.reason });
            console.warn(
              `[openspec/archive] sync failed chatId=${chatId} changeId=${changeId} stage=${sync.stage} reason=${sync.reason}`
            );
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

type SyncResult = { ok: true } | { ok: false; stage: 'status' | 'commit' | 'push' | 'reverify'; reason: string };

interface SyncDeps {
  worktreePath: string;
  changeId: string;
  chatId: string;
  commitAll: ReturnType<typeof trpc.changes.commitAll.useMutation>;
  pushChanges: ReturnType<typeof trpc.changes.push.useMutation>;
  getStatus: () => Promise<GitChangesStatus>;
}

async function syncWorktreeForArchive({
  worktreePath,
  changeId,
  chatId,
  commitAll,
  pushChanges,
  getStatus
}: SyncDeps): Promise<SyncResult> {
  let status;
  try {
    status = await getStatus();
  } catch (err) {
    return { ok: false, stage: 'status', reason: err instanceof Error ? err.message : 'Unknown error' };
  }

  const dirty = status.staged.length + status.unstaged.length + status.untracked.length > 0;
  if (dirty) {
    try {
      await commitAll.mutateAsync({
        worktreePath,
        message: `chore(openspec): archive ${changeId}`
      });
      console.log(`[openspec/archive] auto-commit complete chatId=${chatId} changeId=${changeId}`);
    } catch (err) {
      return { ok: false, stage: 'commit', reason: err instanceof Error ? err.message : 'Commit failed' };
    }
  }

  if (status.hasRemote) {
    try {
      await pushChanges.mutateAsync({ worktreePath, setUpstream: !status.hasUpstream });
      console.log(
        `[openspec/archive] auto-push complete chatId=${chatId} changeId=${changeId} setUpstream=${!status.hasUpstream}`
      );
    } catch (err) {
      return { ok: false, stage: 'push', reason: err instanceof Error ? err.message : 'Push failed' };
    }
  }

  // Re-verify: status must now be clean and (if remote exists) pushed.
  let after;
  try {
    after = await getStatus();
  } catch (err) {
    return { ok: false, stage: 'reverify', reason: err instanceof Error ? err.message : 'Unknown error' };
  }
  const stillDirty = after.staged.length + after.unstaged.length + after.untracked.length > 0;
  const stillUnpushed = after.hasUpstream && after.pushCount > 0;
  if (stillDirty) {
    return { ok: false, stage: 'reverify', reason: 'Uncommitted changes remain after auto-commit.' };
  }
  if (stillUnpushed) {
    return { ok: false, stage: 'reverify', reason: 'Unpushed commits remain after auto-push.' };
  }
  return { ok: true };
}
