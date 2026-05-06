import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { toast } from 'sonner';
import { trpc, trpcClient } from '@/lib/trpc';
import { usePushAction } from '@/features/changes/hooks/use-push-action';
import {
  agentFinishedTickAtomFamily,
  compactingSubChatsAtom,
  diffSidebarOpenAtomFamily,
  filteredDiffFilesAtom,
  filteredSubChatIdAtom,
  loadingSubChatsAtom,
  pendingMergeBaseMessageAtom,
  pendingPrMessageAtom,
  pendingReviewMessageAtom,
  currentPlanPathAtomFamily,
  subChatModeAtomFamily
} from '@/features/agents/atoms';
import { addOrFocus } from '@/features/dock/add-or-focus';
import { useDockApi } from '@/features/dock/dock-context';
import {
  aiEverRespondedAtomFamily,
  localReviewCompletedAtomFamily,
  planEverGeneratedAtomFamily,
  prCreatingAtomFamily
} from '@/features/details-sidebar/atoms';
import { applyModeDefaultModel } from '@/features/agents/lib/model-switching';
import { generateReviewMessage } from '@/features/agents/utils/pr-message';
import {
  computeWorkflowState,
  type WorkflowActionKind,
  type WorkflowInputs,
  type WorkflowState
} from '@/features/agents/utils/workflow-state';

const IDLE_WORKFLOW_STATE: WorkflowState = {
  plan: { id: 'plan', status: 'idle', label: 'Plan', hint: 'Skipped (agent mode)' },
  code: { id: 'code', status: 'idle', label: 'Code', hint: 'No changes' },
  review: { id: 'review', status: 'idle', label: 'Review', hint: 'Waiting on code' },
  pr: { id: 'pr', status: 'idle', label: 'PR', hint: 'Waiting on code/review' },
  next: null
};

/**
 * Read all inputs the Status widget + notch need from atoms / tRPC and return
 * a memoized {@link WorkflowState}. The state machine itself is pure so this
 * hook just feeds it the current values.
 *
 * Recompute triggers come for free via React selectors: jotai atoms,
 * `getPrStatus` polling (30s), `agentFinishedTickAtomFamily` after each AI run.
 */
export function useWorkflowState(chatId: string | null, subChatId: string | null): WorkflowState | null {
  const safeChatId = chatId ?? '';
  const safeSubChatId = subChatId ?? '';

  const mode = useAtomValue(subChatModeAtomFamily(safeSubChatId));
  const loading = useAtomValue(loadingSubChatsAtom);
  const compacting = useAtomValue(compactingSubChatsAtom);
  const [planEverGenerated, setPlanEverGenerated] = useAtom(planEverGeneratedAtomFamily(safeSubChatId));
  const [aiEverResponded, setAiEverResponded] = useAtom(aiEverRespondedAtomFamily(safeSubChatId));
  const localReviewCompleted = useAtomValue(localReviewCompletedAtomFamily(safeSubChatId));
  const [prCreating, setPrCreating] = useAtom(prCreatingAtomFamily(safeSubChatId));
  // Force re-evaluation after each AI run (e.g. a new file was committed externally).
  useAtomValue(agentFinishedTickAtomFamily(safeChatId));

  const isStreaming = !!subChatId && loading.has(subChatId);
  const isCompacting = !!subChatId && compacting.has(subChatId);

  // When mode transitions plan→agent the plan was approved.
  // Persist planEverGenerated so Plan shows as "done" in future sessions.
  const prevModeRef = useRef(mode);
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    if (prev === 'plan' && mode === 'agent' && !planEverGenerated) {
      setPlanEverGenerated(true);
    }
  }, [mode, planEverGenerated, setPlanEverGenerated]);

  // Clear the optimistic "Creating PR…" spinner once the PR shows up.

  // getPrStatus polls every 30s and returns baseBranchBehind plus pr metadata.
  const { data: prStatusData } = trpc.chats.getPrStatus.useQuery(
    { chatId: safeChatId },
    { enabled: !!chatId, refetchInterval: 30000 }
  );

  useEffect(() => {
    if (prCreating && prStatusData?.pr) {
      setPrCreating(false);
    }
  }, [prCreating, prStatusData?.pr, setPrCreating]);

  // For pushCount / hasUpstream / hasRemote we need a worktree path. The
  // simplest route is to read it from the chat record once.
  const { data: chat } = trpc.chats.get.useQuery({ id: safeChatId }, { enabled: !!chatId });
  const worktreePath = chat?.worktreePath ?? null;

  const { data: gitStatus } = trpc.changes.getStatus.useQuery(
    { worktreePath: worktreePath ?? '' },
    { enabled: !!worktreePath, staleTime: 30000 }
  );

  // If prCreating is stuck true but there is no remote (PR can never arrive),
  // clear it immediately so the spinner doesn't spin forever.
  const hasRemoteForPr = gitStatus?.hasRemote ?? false;
  useEffect(() => {
    if (prCreating && !hasRemoteForPr) {
      setPrCreating(false);
    }
  }, [prCreating, hasRemoteForPr, setPrCreating]);

  // When a streaming session ends: mark that the AI has responded at least once
  // (so Plan/Code milestones don't show as idle for fresh-but-not-empty chats),
  // and clear the prCreating spinner if the PR never appeared within 10 s.
  // The aiEverResponded ref lets us skip redundant localStorage writes after
  // the flag has flipped to true (atomWithStorage writes on every set call).
  const wasStreamingRef = useRef(isStreaming);
  const aiEverRespondedRef = useRef(aiEverResponded);
  aiEverRespondedRef.current = aiEverResponded;
  useEffect(() => {
    const wasStreaming = wasStreamingRef.current;
    wasStreamingRef.current = isStreaming;
    if (wasStreaming && !isStreaming) {
      if (!aiEverRespondedRef.current) {
        setAiEverResponded(true);
      }
      if (prCreating) {
        const timeout = setTimeout(() => setPrCreating(false), 10000);
        return () => clearTimeout(timeout);
      }
    }
  }, [isStreaming, prCreating, setPrCreating, setAiEverResponded]);

  const inputs: WorkflowInputs = useMemo(() => {
    const changedFilesCount =
      (gitStatus?.staged?.length ?? 0) + (gitStatus?.unstaged?.length ?? 0) + (gitStatus?.untracked?.length ?? 0);

    const pr = prStatusData?.pr;
    const prState: WorkflowInputs['prState'] = pr ? pr.state : 'none';
    const reviewDecision: WorkflowInputs['reviewDecision'] = pr?.reviewDecision ?? 'none';

    return {
      mode: mode === 'plan' ? 'plan' : 'agent',
      isStreaming,
      isCompacting,
      planEverGenerated,
      hasAiResponded: aiEverResponded,
      changedFilesCount,
      pushCount: gitStatus?.pushCount ?? 0,
      hasUpstream: gitStatus?.hasUpstream ?? false,
      hasRemote: gitStatus?.hasRemote ?? false,
      baseBranchBehind: prStatusData?.baseBranchBehind ?? 0,
      prState,
      reviewDecision,
      localReviewCompleted,
      prCreating
    };
  }, [
    mode,
    isStreaming,
    isCompacting,
    planEverGenerated,
    aiEverResponded,
    gitStatus?.staged,
    gitStatus?.unstaged,
    gitStatus?.untracked,
    gitStatus?.pushCount,
    gitStatus?.hasUpstream,
    gitStatus?.hasRemote,
    prStatusData?.pr,
    prStatusData?.baseBranchBehind,
    localReviewCompleted,
    prCreating
  ]);

  return useMemo(() => {
    if (!chatId) return null;
    // No active sub-chat: show all-idle so the widget renders but makes no claims
    if (!subChatId) return IDLE_WORKFLOW_STATE;
    return computeWorkflowState(inputs);
  }, [chatId, subChatId, inputs]);
}

/**
 * Returns a single dispatcher that performs the action for a milestone click
 * (or the matching notch button). All actions either mutate via tRPC, push a
 * message into a `pendingXMessageAtom` (consumed elsewhere in active-chat.tsx),
 * or open an external URL — none of them depend on local component state, so
 * this hook can be reused from any consumer that has chatId + subChatId.
 */
export function useWorkflowActions(chatId: string | null, subChatId: string | null) {
  const safeChatId = chatId ?? '';
  const safeSubChatId = subChatId ?? '';

  const setPendingPrMessage = useSetAtom(pendingPrMessageAtom);
  const setPendingMergeBaseMessage = useSetAtom(pendingMergeBaseMessageAtom);
  const setPendingReviewMessage = useSetAtom(pendingReviewMessageAtom);
  const setLocalReviewCompleted = useSetAtom(localReviewCompletedAtomFamily(safeSubChatId));
  const setPrCreating = useSetAtom(prCreatingAtomFamily(safeSubChatId));
  const setFilteredDiffFiles = useSetAtom(filteredDiffFilesAtom);
  const setFilteredSubChatId = useSetAtom(filteredSubChatIdAtom);
  const setDiffSidebarOpen = useSetAtom(diffSidebarOpenAtomFamily(safeChatId));
  const dockApi = useDockApi();
  const planPath = useAtomValue(currentPlanPathAtomFamily(safeSubChatId));
  const trpcUtils = trpc.useUtils();

  const { data: chat } = trpc.chats.get.useQuery({ id: safeChatId }, { enabled: !!chatId });
  const worktreePath = chat?.worktreePath ?? null;
  const baseBranch = chat?.baseBranch ?? 'main';
  const prUrl = chat?.prUrl ?? null;

  const { data: gitStatus } = trpc.changes.getStatus.useQuery(
    { worktreePath: worktreePath ?? '' },
    { enabled: !!worktreePath, staleTime: 30000 }
  );
  const hasUpstream = gitStatus?.hasUpstream ?? false;

  const {
    push: pushBranch,
    isPending: isPushPending,
    dialog: pushDialog
  } = usePushAction({
    worktreePath,
    hasUpstream,
    onSuccess: () => {
      if (chatId) {
        trpcUtils.chats.getPrStatus.invalidate({ chatId });
      }
      if (worktreePath) {
        trpcUtils.changes.getStatus.invalidate({ worktreePath });
      }
    }
  });

  const dispatch = useCallback(
    async (kind: WorkflowActionKind) => {
      if (!chatId || !subChatId) return;

      switch (kind) {
        case 'expandPlan':
          if (dockApi && planPath) {
            addOrFocus(dockApi, {
              kind: 'plan',
              data: { chatId: subChatId, planPath }
            });
          }
          break;

        case 'mergeBase':
          setPendingMergeBaseMessage({
            message: `Merge latest from ${baseBranch} into the current branch and resolve any conflicts. Run \`git fetch origin ${baseBranch}\` first, then \`git merge origin/${baseBranch}\`. Resolve any conflicts and commit the merge.`,
            subChatId
          });
          break;

        case 'pushBranch':
          pushBranch();
          break;

        case 'reviewLocal':
          setFilteredSubChatId(subChatId);
          setFilteredDiffFiles(null);
          setDiffSidebarOpen(true);
          setLocalReviewCompleted(true);
          break;

        case 'reviewPr': {
          try {
            // Switch to the configured Review-mode model FIRST, before the
            // await yields the event loop. This guarantees the model is in
            // place by the time the transport reads it.
            applyModeDefaultModel(subChatId, 'review');
            const context = await trpcClient.chats.getPrContext.query({
              chatId
            });
            if (!context) {
              toast.error('Could not get git context', {
                position: 'top-center'
              });
              return;
            }
            const message = generateReviewMessage(context);
            setPendingReviewMessage({ message, subChatId });
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to start review', { position: 'top-center' });
          }
          break;
        }

        case 'createPr': {
          setPrCreating(true);
          // Reuse `createPr` even when a PR already exists: the user intent is
          // still "get my latest work into the PR" and the prompt handles both paths.
          const message = [
            'Bring the current branch into a clean state and ensure a PR exists.',
            '',
            'Steps:',
            '1. Run `git status --short` to see uncommitted files.',
            '2. If there are uncommitted changes:',
            '   - Run `git diff` (and `git diff --cached`) to understand what changed.',
            '   - Stage all changes with `git add -A`.',
            '   - Commit with a clear, concise message (under 80 chars subject; body if needed).',
            '3. Run `git status -sb` to confirm the tree is clean and check ahead/behind.',
            '4. If there are unpushed commits, run `git push` (use `git push -u origin HEAD` if there is no upstream).',
            '5. Check whether a PR already exists for this branch. Use `gh pr list --head "$(git branch --show-current)" --state all --json number,state,url` (or the `az repos pr list` equivalent for Azure DevOps). Inspect the JSON output: an empty array `[]` means no PR exists; a non-empty array means a PR exists.',
            '   - If `gh` (or `az`) is not installed, not authenticated, or the command otherwise errors: STOP. Do NOT assume "no PR exists" and do NOT call `gh pr create` — that risks a duplicate PR. Report the failure and ask the user for help.',
            '   - If a PR already exists (any state — open, merged, or closed): do NOT create a duplicate. Report the PR URL and stop.',
            `   - If the lookup succeeded and the array is empty: create one with \`gh pr create --base "${baseBranch}"\` (or the Azure DevOps equivalent). Title under 80 chars; description under five sentences.`,
            '6. If any step fails, stop and ask the user for help — do not proceed with later steps.'
          ].join('\n');
          setPendingPrMessage({ message, subChatId });
          break;
        }

        case 'openPr':
          if (prUrl) {
            window.desktopApi.openExternal(prUrl);
          }
          break;
      }
    },
    [
      chatId,
      subChatId,
      baseBranch,
      prUrl,
      pushBranch,
      dockApi,
      planPath,
      setPendingMergeBaseMessage,
      setFilteredSubChatId,
      setFilteredDiffFiles,
      setDiffSidebarOpen,
      setLocalReviewCompleted,
      setPendingReviewMessage,
      setPrCreating,
      setPendingPrMessage
    ]
  );

  return {
    dispatch,
    pushDialog,
    isActionPending: {
      pushBranch: isPushPending
    } as Partial<Record<WorkflowActionKind, boolean>>
  };
}
