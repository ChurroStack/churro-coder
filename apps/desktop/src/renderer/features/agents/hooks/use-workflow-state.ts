import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { trpc } from '@/lib/trpc';
import { usePushAction } from '@/features/changes/hooks/use-push-action';
import {
  compactingSubChatsAtom,
  diffSidebarOpenAtomFamily,
  filteredDiffFilesAtom,
  filteredSubChatIdAtom,
  loadingSubChatsAtom,
  pendingMergeBaseMessageAtom,
  pendingPrMessageAtom,
  currentPlanPathAtomFamily
} from '@/features/agents/atoms';
import { addOrFocus } from '@/features/dock/add-or-focus';
import { useDockApi } from '@/features/dock/dock-context';
import { aiEverRespondedAtomFamily, prCreatingAtomFamily } from '@/features/details-sidebar/atoms';
import { renderBuiltinPrompt } from '../../../../prompts/render';
import {
  computeWorkflowState,
  type WorkflowActionKind,
  type WorkflowState
} from '@/features/agents/utils/workflow-state';
import { useWorkflowSnapshot } from './use-workflow-snapshot';

const IDLE_WORKFLOW_STATE: WorkflowState = {
  plan: { id: 'plan', status: 'idle', label: 'Plan', hint: 'Skipped (execute mode)' },
  code: { id: 'code', status: 'idle', label: 'Code', hint: 'No changes' },
  review: { id: 'review', status: 'idle', label: 'Review', hint: 'Waiting on code' },
  pr: { id: 'pr', status: 'idle', label: 'PR', hint: 'Waiting on code/review' },
  next: null
};

/**
 * Read all inputs the Status widget + notch need from atoms / tRPC and return
 * a memoized {@link WorkflowState}. The state machine itself is pure so this
 * hook just feeds it the current values via {@link useWorkflowSnapshot}.
 *
 * Recompute triggers come for free via React selectors: jotai atoms,
 * `getPrStatus` polling (30s), `agentFinishedTickAtomFamily` after each AI run.
 */
export function useWorkflowState(chatId: string | null, subChatId: string | null): WorkflowState | null {
  const safeChatId = chatId ?? '';
  const safeSubChatId = subChatId ?? '';

  const loading = useAtomValue(loadingSubChatsAtom);
  const compacting = useAtomValue(compactingSubChatsAtom);
  const [aiEverResponded, setAiEverResponded] = useAtom(aiEverRespondedAtomFamily(safeSubChatId));
  const [prCreating, setPrCreating] = useAtom(prCreatingAtomFamily(safeSubChatId));

  const isStreaming = !!subChatId && loading.has(subChatId);

  const snapshot = useWorkflowSnapshot(chatId, subChatId);

  // For getPrStatus / getStatus invalidation we need the worktree path.
  const { data: chat } = trpc.chats.get.useQuery({ id: safeChatId }, { enabled: !!chatId });
  const worktreePath = chat?.worktreePath ?? null;

  const { data: prStatusData } = trpc.chats.getPrStatus.useQuery(
    { chatId: safeChatId },
    { enabled: !!chatId, refetchInterval: 30000 }
  );

  const trpcUtils = trpc.useUtils();

  // Clear the optimistic "Creating PR…" spinner once the PR shows up.
  useEffect(() => {
    if (prCreating && prStatusData?.pr) {
      setPrCreating(false);
    }
  }, [prCreating, prStatusData?.pr, setPrCreating]);

  // If prCreating is stuck true but there is no remote (PR can never arrive),
  // clear it immediately so the spinner doesn't spin forever.
  const hasRemoteForPr = snapshot?.git.hasRemote ?? false;
  useEffect(() => {
    if (prCreating && !hasRemoteForPr) {
      setPrCreating(false);
    }
  }, [prCreating, hasRemoteForPr, setPrCreating]);

  // Keep refs for invalidation targets so they're always current inside the effect.
  const worktreePathRef = useRef(worktreePath);
  worktreePathRef.current = worktreePath;
  const safeChatIdRef = useRef(safeChatId);
  safeChatIdRef.current = safeChatId;
  const aiEverRespondedRef = useRef(aiEverResponded);
  aiEverRespondedRef.current = aiEverResponded;
  const wasStreamingRef = useRef(isStreaming);

  // When a streaming session ends: mark that the AI has responded at least once,
  // invalidate durable queries, and clear the prCreating spinner if the PR never
  // appeared within 10 s.
  useEffect(() => {
    const wasStreaming = wasStreamingRef.current;
    wasStreamingRef.current = isStreaming;
    if (wasStreaming && !isStreaming) {
      if (!aiEverRespondedRef.current) {
        setAiEverResponded(true);
      }
      // Invalidate durable queries so stale indicators (e.g. "Update from base",
      // PR status) clear immediately after every agent run rather than waiting
      // for the 30 s poll interval.
      trpcUtils.chats.getPrStatus.invalidate({ chatId: safeChatIdRef.current });
      // Invalidate artifact queries so Plan/Review milestones reflect any new artifacts.
      trpcUtils.chats.getCurrentPlan.invalidate({ subChatId: safeSubChatId });
      trpcUtils.chats.getCurrentReview.invalidate({ subChatId: safeSubChatId });
      trpcUtils.chats.getReviewContent.invalidate({ subChatId: safeSubChatId });
      if (worktreePathRef.current) {
        trpcUtils.changes.getStatus.invalidate({ worktreePath: worktreePathRef.current });
      }
      if (prCreating) {
        const timeout = setTimeout(() => setPrCreating(false), 10000);
        return () => clearTimeout(timeout);
      }
    }
  }, [isStreaming, prCreating, setPrCreating, setAiEverResponded, trpcUtils, safeSubChatId]);

  return useMemo(() => {
    if (!chatId) return null;
    if (!subChatId) return IDLE_WORKFLOW_STATE;
    if (!snapshot) return IDLE_WORKFLOW_STATE;
    return computeWorkflowState(snapshot);
  }, [chatId, subChatId, snapshot]);
}

/**
 * Returns a single dispatcher that performs the action for a milestone click
 * (or the matching notch button). All actions either mutate via tRPC, push a
 * message into a `pendingXMessageAtom` (consumed elsewhere in active-chat.tsx),
 * or open an external URL — none of them depend on local component state, so
 * this hook can be reused from any consumer that has chatId + subChatId.
 *
 * ## Dispatcher invalidation table
 *
 * | Action        | Query mutations / invalidations                                  |
 * |---------------|------------------------------------------------------------------|
 * | expandPlan    | none (UI-only — opens dock panel)                               |
 * | mergeBase     | invalidates getPrStatus + changes.getStatus immediately;        |
 * |               | streaming-end effect in useWorkflowState re-invalidates after   |
 * |               | the agent completes the merge                                    |
 * | pushBranch    | invalidates getPrStatus + changes.getStatus in onSuccess        |
 * | reviewLocal   | one-shot getCurrentReview.fetch; opens review panel if artifact |
 * |               | exists, else opens diff sidebar. Does NOT trigger the AI —      |
 * |               | the canonical AI-trigger surface is the changes/diff Review     |
 * |               | button (`useReviewAction.runReview`).                           |
 * | reviewPr      | same as reviewLocal (both navigational; no AI trigger).         |
 * | createPr      | none (sets prCreatingAtom; getPrStatus poll picks up new PR)    |
 * | openPr        | none (opens external URL)                                       |
 *
 * Post-streaming: useWorkflowState always invalidates getPrStatus + getStatus + getCurrentPlan
 * when isStreaming transitions true→false, keeping milestones fresh regardless
 * of which agent-driven action (mergeBase, reviewPr, createPr) just ran.
 */
export function useWorkflowActions(chatId: string | null, subChatId: string | null) {
  const safeChatId = chatId ?? '';
  const safeSubChatId = subChatId ?? '';

  const setPendingPrMessage = useSetAtom(pendingPrMessageAtom);
  const setPendingMergeBaseMessage = useSetAtom(pendingMergeBaseMessageAtom);
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
  // Dedup'd against useWorkflowState's getPrStatus subscription — used purely
  // as a cold-load fallback for hasUpstream below.
  const { data: prStatusDataForUpstream } = trpc.chats.getPrStatus.useQuery(
    { chatId: safeChatId },
    { enabled: !!chatId, refetchInterval: 30000 }
  );
  // A PR (live or DB-backed) proves the branch was pushed. Fall back to it so
  // a Push click during the cold-load window doesn't pass `setUpstream: true`
  // for a branch that already has tracking configured. Mirrors the same
  // asymmetric-fallback fix applied in use-workflow-snapshot.ts.
  const hasUpstream = gitStatus?.hasUpstream ?? (!!prStatusDataForUpstream?.pr || !!chat?.prNumber);

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
            message: renderBuiltinPrompt('workflow/merge-base', { baseBranch }),
            subChatId
          });
          trpcUtils.chats.getPrStatus.invalidate({ chatId });
          if (worktreePath) {
            trpcUtils.changes.getStatus.invalidate({ worktreePath });
          }
          break;

        case 'pushBranch':
          pushBranch();
          break;

        // Both review actions just open the "review window". The AI is only
        // triggered from the changes/diff panel's Review button — keeping
        // the workflow badge and notch buttons strictly navigational means
        // the user can't accidentally kick off a costly review run by
        // clicking the milestone, and there's a single canonical surface
        // (the changes view) where reviews start.
        case 'reviewLocal':
        case 'reviewPr': {
          // If a review artifact exists, open the review dock panel so the
          // user can read it. Otherwise fall back to opening the changes
          // view, where the canonical "Review" button lives.
          let reviewExists = false;
          try {
            const review = await trpcUtils.chats.getCurrentReview.fetch({ subChatId });
            reviewExists = !!review?.exists;
          } catch {
            // ignore — fall back to diff sidebar
          }
          if (reviewExists && dockApi) {
            addOrFocus(dockApi, { kind: 'review', data: { subChatId } });
          } else {
            setFilteredSubChatId(subChatId);
            setFilteredDiffFiles(null);
            setDiffSidebarOpen(true);
          }
          break;
        }

        case 'createPr': {
          setPrCreating(true);
          // Reuse `createPr` even when a PR already exists: the user intent is
          // still "get my latest work into the PR" and the prompt handles both paths.
          const message = renderBuiltinPrompt('workflow/create-pr-clean', { baseBranch });
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
      worktreePath,
      trpcUtils,
      setPendingMergeBaseMessage,
      setFilteredSubChatId,
      setFilteredDiffFiles,
      setDiffSidebarOpen,
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
