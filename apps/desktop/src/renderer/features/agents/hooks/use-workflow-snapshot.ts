import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { trpc } from '@/lib/trpc';
import { agentFinishedTickAtomFamily, compactingSubChatsAtom, loadingSubChatsAtom } from '@/features/agents/atoms';
import { useSubChatMode } from '@/features/agents/hooks/use-sub-chat-mode';
import { aiEverRespondedAtomFamily, prCreatingAtomFamily } from '@/features/details-sidebar/atoms';
import type { WorkflowSnapshot, WorkflowActivity } from '@/features/agents/utils/workflow-state';

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
  const loading = useAtomValue(loadingSubChatsAtom);
  const compacting = useAtomValue(compactingSubChatsAtom);
  const aiEverResponded = useAtomValue(aiEverRespondedAtomFamily(safeSubChatId));
  const prCreating = useAtomValue(prCreatingAtomFamily(safeSubChatId));

  // Subscribe to the finished-tick atom so snapshot re-evaluates after each AI run.
  useAtomValue(agentFinishedTickAtomFamily(safeChatId));

  const isStreaming = !!subChatId && loading.has(subChatId);
  const isCompacting = !!subChatId && compacting.has(subChatId);
  const activity: WorkflowActivity = isCompacting ? 'compacting' : isStreaming ? 'streaming' : 'idle';

  const { data: planData } = trpc.chats.getCurrentPlan.useQuery({ subChatId: safeSubChatId }, { enabled: !!subChatId });

  // Narrow to just `exists` so changes to review content (e.g. mid-stream
  // markdown updates) don't re-fan-out to every Status-widget consumer.
  const { data: reviewExists } = trpc.chats.getCurrentReview.useQuery(
    { subChatId: safeSubChatId },
    { enabled: !!subChatId, select: (d) => (d ? { exists: d.exists } : d) }
  );

  const { data: chat } = trpc.chats.get.useQuery({ id: safeChatId }, { enabled: !!chatId });
  const worktreePath = chat?.worktreePath ?? null;

  const { data: gitStatus } = trpc.changes.getStatus.useQuery(
    { worktreePath: worktreePath ?? '' },
    { enabled: !!worktreePath, staleTime: 30000 }
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
    // Fall back to the DB-backed prNumber whenever the live query has no data
    // (either still loading on startup, or returned null because gh CLI is slow /
    // the query just re-fired after streaming ended). chat.prNumber is written the
    // moment a PR is created via the app and is cheap to read, so it avoids a
    // gray badge during the 5-15 s gh CLI round-trip. Once the live query
    // resolves it takes over with the authoritative state (open/merged/closed).
    const prState: WorkflowSnapshot['pr']['state'] = pr
      ? (pr.state as WorkflowSnapshot['pr']['state'])
      : chat?.prNumber
        ? 'open'
        : 'none';
    const reviewDecision = (pr?.reviewDecision ?? 'none') as WorkflowSnapshot['pr']['reviewDecision'];

    const normalizedMode: WorkflowSnapshot['mode'] =
      mode === 'execute' ? 'execute' : mode === 'review' ? 'review' : mode === 'explore' ? 'explore' : 'plan';

    return {
      mode: normalizedMode,
      activity,
      // planData is `undefined` while loading, `{ exists: false }` when no file, `{ exists: true, meta }` when file exists.
      // Map undefined → null so the compute function can distinguish "loading" from "no plan".
      plan: planData ?? null,
      // reviewExists is undefined while loading, { exists: false } when no file, { exists: true } when file exists.
      // Map undefined → null so the compute function can distinguish "loading" from "no review", matching plan handling.
      review: reviewExists ?? null,
      git: {
        changedFiles,
        // headSha not yet in getStatus — placeholder for PR 5 review-staleness check.
        headSha: '',
        // A PR (live or DB) is definitive proof a remote exists. OR rather than
        // ?? to override both the loading case (undefined) and false negatives
        // from getStatus. prStatusData?.pr covers when getPrStatus has live data
        // but chats.get cache is still stale (prNumber not yet re-fetched).
        hasRemote: !!gitStatus?.hasRemote || !!prStatusData?.pr || !!chat?.prNumber
      },
      pushCount: gitStatus?.pushCount ?? 0,
      // A PR (live or DB) proves the branch was pushed — you can't open a PR without
      // pushing first. Use it as a fallback so the Code pill doesn't flash amber
      // "Push branch to origin" during the window while getStatus is still in-flight
      // but prStatusData already resolved from cache.
      hasUpstream: gitStatus?.hasUpstream ?? (!!prStatusData?.pr || !!chat?.prNumber),
      baseBranchBehind: prStatusData?.baseBranchBehind ?? 0,
      pr: { state: prState, reviewDecision, creating: prCreating },
      hasHistory: aiEverResponded
    };
  }, [
    chatId,
    subChatId,
    mode,
    activity,
    planData,
    reviewExists,
    gitStatus,
    prStatusData,
    prCreating,
    aiEverResponded,
    chat
  ]);
}
