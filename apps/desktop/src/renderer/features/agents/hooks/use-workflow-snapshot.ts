import { useMemo } from 'react';
import { resolveHasUpstream } from '../../../../shared/changes-types';
import { useAtomValue } from 'jotai';
import { trpc } from '@/lib/trpc';
import {
  agentFinishedTickAtomFamily,
  cliBusyAtomFamily,
  compactingSubChatsAtom,
  subChatBusyAtomFamily
} from '@/features/agents/atoms';
import { useSubChatMode } from '@/features/agents/hooks/use-sub-chat-mode';
import { aiEverRespondedAtomFamily, prCreatingAtomFamily } from '@/features/details-sidebar/atoms';
import type { TasksInfo, WorkflowSnapshot, WorkflowActivity } from '@/features/agents/utils/workflow-state';

/**
 * Assembles a {@link WorkflowSnapshot} for the given chat/sub-chat pair.
 * Returns `null` when either ID is absent (no sub-chat selected).
 *
 * Pure data assembly — no write side effects. Side effects that manage
 * `prCreating` and `aiEverResponded` stay in `useWorkflowState()`.
 */
export function useWorkflowSnapshot(chatId: string | null, subChatId: string | null): WorkflowSnapshot | null {
  const safeChatId = chatId ?? '';
  const safeSubChatId = subChatId ?? '';

  const { mode } = useSubChatMode(safeSubChatId);
  const isStreaming = useAtomValue(subChatBusyAtomFamily(safeSubChatId));
  const compacting = useAtomValue(compactingSubChatsAtom);
  const aiEverResponded = useAtomValue(aiEverRespondedAtomFamily(safeSubChatId));
  const prCreating = useAtomValue(prCreatingAtomFamily(safeSubChatId));
  const cliBusy = useAtomValue(cliBusyAtomFamily(safeSubChatId));

  // Subscribe to the finished-tick atom so snapshot re-evaluates after each AI run.
  useAtomValue(agentFinishedTickAtomFamily(safeChatId));

  const isCompacting = !!subChatId && compacting.has(subChatId);
  const activity: WorkflowActivity = isCompacting ? 'compacting' : isStreaming ? 'streaming' : 'idle';

  const { data: planData } = trpc.chats.getCurrentPlan.useQuery({ subChatId: safeSubChatId }, { enabled: !!subChatId });

  // Narrow to just `exists` + meta timestamps so changes to review content don't
  // re-fan-out to every Status-widget consumer.
  const { data: reviewData } = trpc.chats.getCurrentReview.useQuery(
    { subChatId: safeSubChatId },
    {
      enabled: !!subChatId,
      select: (d) =>
        d
          ? d.exists
            ? { exists: true as const, meta: { createdAt: d.meta?.createdAt, acceptedAt: d.meta?.acceptedAt } }
            : { exists: false as const }
          : d
    }
  );

  const { data: tasksData } = trpc.chats.getCurrentTasks.useQuery(
    { subChatId: safeSubChatId },
    { enabled: !!subChatId }
  );

  const { data: chat } = trpc.chats.get.useQuery({ id: safeChatId }, { enabled: !!chatId });
  const worktreePath = chat?.worktreePath ?? null;

  // Derive harness from the active sub-chat row in the chat response.
  const subChatHarness = useMemo(() => {
    if (!chat || !subChatId) return 'builtin';
    const sc = (chat.subChats ?? []).find((s: { id: string; harness?: string }) => s.id === subChatId);
    return sc?.harness === 'claude-cli' || sc?.harness === 'codex-cli' ? 'cli' : 'builtin';
  }, [chat, subChatId]) as 'builtin' | 'cli';

  const { data: gitStatus } = trpc.changes.getStatus.useQuery(
    { worktreePath: worktreePath ?? '' },
    { enabled: !!worktreePath, staleTime: 30000, refetchOnMount: 'always' }
  );

  const { data: prStatusData } = trpc.chats.getPrStatus.useQuery(
    { chatId: safeChatId },
    { enabled: !!chatId, refetchInterval: 30000 }
  );

  return useMemo<WorkflowSnapshot | null>(() => {
    if (!chatId || !subChatId) return null;

    const changedFiles =
      (gitStatus?.staged?.length ?? 0) + (gitStatus?.unstaged?.length ?? 0) + (gitStatus?.untracked?.length ?? 0);

    const pr = prStatusData?.pr;
    const prState: WorkflowSnapshot['pr']['state'] = pr
      ? (pr.state as WorkflowSnapshot['pr']['state'])
      : chat?.prNumber
        ? 'open'
        : 'none';
    const reviewDecision = (pr?.reviewDecision ?? 'none') as WorkflowSnapshot['pr']['reviewDecision'];

    const normalizedMode: WorkflowSnapshot['mode'] =
      mode === 'execute' ? 'execute' : mode === 'explore' ? 'explore' : 'plan';

    // Build tasks info — null when query still loading, TasksInfo when resolved.
    const tasks: TasksInfo | null = tasksData
      ? tasksData.exists
        ? {
            exists: true,
            total: tasksData.tasks.length,
            completed: tasksData.tasks.filter((t: { status: string }) => t.status === 'completed').length,
            updatedAt: tasksData.meta.updatedAt ?? null
          }
        : { exists: false, total: 0, completed: 0, updatedAt: null }
      : null;

    return {
      mode: normalizedMode,
      activity,
      harness: subChatHarness,
      cliBusy,
      // planData is `undefined` while loading, `{ exists: false }` when no file, `{ exists: true, meta }` when file exists.
      // Map undefined → null so the compute function can distinguish "loading" from "no plan".
      plan: planData ?? null,
      // reviewData is undefined while loading; map to null for same reason.
      review: reviewData ?? null,
      tasks,
      git: {
        changedFiles,
        headSha: '',
        hasRemote: !!gitStatus?.hasRemote || !!prStatusData?.pr || !!chat?.prNumber
      },
      pushCount: gitStatus?.pushCount ?? 0,
      hasUpstream: resolveHasUpstream(gitStatus, !!prStatusData?.pr || !!chat?.prNumber),
      baseBranchBehind: prStatusData?.baseBranchBehind ?? 0,
      pr: { state: prState, reviewDecision, creating: prCreating },
      hasHistory: aiEverResponded
    };
  }, [
    chatId,
    subChatId,
    mode,
    activity,
    subChatHarness,
    cliBusy,
    planData,
    reviewData,
    tasksData,
    gitStatus,
    prStatusData,
    prCreating,
    aiEverResponded,
    chat
  ]);
}
