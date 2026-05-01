import { useCallback, useEffect, useMemo, useRef } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { toast } from "sonner"
import { trpc, trpcClient } from "@/lib/trpc"
import { usePushAction } from "@/features/changes/hooks/use-push-action"
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
  planSidebarOpenAtomFamily,
  subChatModeAtomFamily,
} from "@/features/agents/atoms"
import {
  localReviewCompletedAtomFamily,
  planEverGeneratedAtomFamily,
  prCreatingAtomFamily,
} from "@/features/details-sidebar/atoms"
import { applyModeDefaultModel } from "@/features/agents/lib/model-switching"
import { generateReviewMessage } from "@/features/agents/utils/pr-message"
import {
  computeWorkflowState,
  type WorkflowActionKind,
  type WorkflowInputs,
  type WorkflowState,
} from "@/features/agents/utils/workflow-state"

const IDLE_WORKFLOW_STATE: WorkflowState = {
  plan: { id: "plan", status: "idle", label: "Plan", hint: "Skipped (agent mode)" },
  code: { id: "code", status: "idle", label: "Code", hint: "No changes" },
  review: { id: "review", status: "idle", label: "Review", hint: "Waiting on code" },
  pr: { id: "pr", status: "idle", label: "PR", hint: "Waiting on code/review" },
  next: null,
}

/**
 * Read all inputs the Status widget + notch need from atoms / tRPC and return
 * a memoized {@link WorkflowState}. The state machine itself is pure so this
 * hook just feeds it the current values.
 *
 * Recompute triggers come for free via React selectors: jotai atoms,
 * `getPrStatus` polling (30s), `agentFinishedTickAtomFamily` after each AI run.
 */
export function useWorkflowState(
  chatId: string | null,
  subChatId: string | null,
): WorkflowState | null {
  const safeChatId = chatId ?? ""
  const safeSubChatId = subChatId ?? ""

  const mode = useAtomValue(subChatModeAtomFamily(safeSubChatId))
  const loading = useAtomValue(loadingSubChatsAtom)
  const compacting = useAtomValue(compactingSubChatsAtom)
  const [planEverGenerated, setPlanEverGenerated] = useAtom(
    planEverGeneratedAtomFamily(safeSubChatId),
  )
  const localReviewCompleted = useAtomValue(
    localReviewCompletedAtomFamily(safeSubChatId),
  )
  const [prCreating, setPrCreating] = useAtom(
    prCreatingAtomFamily(safeSubChatId),
  )
  // Force re-evaluation after each AI run (e.g. a new file was committed externally).
  useAtomValue(agentFinishedTickAtomFamily(safeChatId))

  const isStreaming = !!subChatId && loading.has(subChatId)
  const isCompacting = !!subChatId && compacting.has(subChatId)

  // When mode transitions plan→agent the plan was approved.
  // Persist planEverGenerated so Plan shows as "done" in future sessions.
  const prevModeRef = useRef(mode)
  useEffect(() => {
    const prev = prevModeRef.current
    prevModeRef.current = mode
    if (prev === "plan" && mode === "agent" && !planEverGenerated) {
      setPlanEverGenerated(true)
    }
  }, [mode, planEverGenerated, setPlanEverGenerated])

  // Clear the optimistic "Creating PR…" spinner once the PR shows up.

  // getPrStatus polls every 30s and returns baseBranchBehind plus pr metadata.
  const { data: prStatusData } = trpc.chats.getPrStatus.useQuery(
    { chatId: safeChatId },
    { enabled: !!chatId, refetchInterval: 30000 },
  )

  useEffect(() => {
    if (prCreating && prStatusData?.pr) {
      setPrCreating(false)
    }
  }, [prCreating, prStatusData?.pr, setPrCreating])

  // For pushCount / hasUpstream / hasRemote we need a worktree path. The
  // simplest route is to read it from the chat record once.
  const { data: chat } = trpc.chats.get.useQuery(
    { id: safeChatId },
    { enabled: !!chatId },
  )
  const worktreePath = chat?.worktreePath ?? null

  const { data: gitStatus } = trpc.changes.getStatus.useQuery(
    { worktreePath: worktreePath ?? "" },
    { enabled: !!worktreePath, staleTime: 30000 },
  )

  // If prCreating is stuck true but there is no remote (PR can never arrive),
  // clear it immediately so the spinner doesn't spin forever.
  const hasRemoteForPr = gitStatus?.hasRemote ?? false
  useEffect(() => {
    if (prCreating && !hasRemoteForPr) {
      setPrCreating(false)
    }
  }, [prCreating, hasRemoteForPr, setPrCreating])

  // Clear prCreating when the AI run that was supposed to open the PR ends
  // without one appearing. The 10s grace window covers the gap between the
  // stream finishing and the next getPrStatus poll picking up the new PR.
  // Without this, an AI failure (network error, gh-auth, agent abort) would
  // leave the spinner stuck forever.
  const wasStreamingRef = useRef(isStreaming)
  useEffect(() => {
    const wasStreaming = wasStreamingRef.current
    wasStreamingRef.current = isStreaming
    if (wasStreaming && !isStreaming && prCreating) {
      const timeout = setTimeout(() => setPrCreating(false), 10000)
      return () => clearTimeout(timeout)
    }
  }, [isStreaming, prCreating, setPrCreating])

  const inputs: WorkflowInputs = useMemo(() => {
    const changedFilesCount =
      (gitStatus?.staged?.length ?? 0) +
      (gitStatus?.unstaged?.length ?? 0) +
      (gitStatus?.untracked?.length ?? 0)

    const pr = prStatusData?.pr
    const prState: WorkflowInputs["prState"] = pr ? pr.state : "none"
    const reviewDecision: WorkflowInputs["reviewDecision"] =
      pr?.reviewDecision ?? "none"

    return {
      mode: mode === "plan" ? "plan" : "agent",
      isStreaming,
      isCompacting,
      planEverGenerated,
      changedFilesCount,
      pushCount: gitStatus?.pushCount ?? 0,
      hasUpstream: gitStatus?.hasUpstream ?? false,
      hasRemote: gitStatus?.hasRemote ?? false,
      baseBranchBehind: prStatusData?.baseBranchBehind ?? 0,
      prState,
      reviewDecision,
      localReviewCompleted,
      prCreating,
    }
  }, [
    mode,
    isStreaming,
    isCompacting,
    planEverGenerated,
    gitStatus?.staged,
    gitStatus?.unstaged,
    gitStatus?.untracked,
    gitStatus?.pushCount,
    gitStatus?.hasUpstream,
    gitStatus?.hasRemote,
    prStatusData?.pr,
    prStatusData?.baseBranchBehind,
    localReviewCompleted,
    prCreating,
  ])

  return useMemo(() => {
    if (!chatId) return null
    // No active sub-chat: show all-idle so the widget renders but makes no claims
    if (!subChatId) return IDLE_WORKFLOW_STATE
    return computeWorkflowState(inputs)
  }, [chatId, subChatId, inputs])
}

/**
 * Returns a single dispatcher that performs the action for a milestone click
 * (or the matching notch button). All actions either mutate via tRPC, push a
 * message into a `pendingXMessageAtom` (consumed elsewhere in active-chat.tsx),
 * or open an external URL — none of them depend on local component state, so
 * this hook can be reused from any consumer that has chatId + subChatId.
 */
export function useWorkflowActions(
  chatId: string | null,
  subChatId: string | null,
) {
  const safeChatId = chatId ?? ""
  const safeSubChatId = subChatId ?? ""

  const setPendingPrMessage = useSetAtom(pendingPrMessageAtom)
  const setPendingMergeBaseMessage = useSetAtom(pendingMergeBaseMessageAtom)
  const setPendingReviewMessage = useSetAtom(pendingReviewMessageAtom)
  const setLocalReviewCompleted = useSetAtom(
    localReviewCompletedAtomFamily(safeSubChatId),
  )
  const setPrCreating = useSetAtom(prCreatingAtomFamily(safeSubChatId))
  const setFilteredDiffFiles = useSetAtom(filteredDiffFilesAtom)
  const setFilteredSubChatId = useSetAtom(filteredSubChatIdAtom)
  const setDiffSidebarOpen = useSetAtom(diffSidebarOpenAtomFamily(safeChatId))
  const setPlanSidebarOpen = useSetAtom(planSidebarOpenAtomFamily(safeSubChatId))
  const trpcUtils = trpc.useUtils()

  const { data: chat } = trpc.chats.get.useQuery(
    { id: safeChatId },
    { enabled: !!chatId },
  )
  const worktreePath = chat?.worktreePath ?? null
  const baseBranch = chat?.baseBranch ?? "main"
  const prUrl = chat?.prUrl ?? null

  const { data: gitStatus } = trpc.changes.getStatus.useQuery(
    { worktreePath: worktreePath ?? "" },
    { enabled: !!worktreePath, staleTime: 30000 },
  )
  const hasUpstream = gitStatus?.hasUpstream ?? false

  const { push: pushBranch, dialog: pushDialog } = usePushAction({
    worktreePath,
    hasUpstream,
    onSuccess: () => {
      if (chatId) {
        trpcUtils.chats.getPrStatus.invalidate({ chatId })
      }
      if (worktreePath) {
        trpcUtils.changes.getStatus.invalidate({ worktreePath })
      }
    },
  })

  const dispatch = useCallback(
    async (kind: WorkflowActionKind) => {
      if (!chatId || !subChatId) return

      switch (kind) {
        case "expandPlan":
          setPlanSidebarOpen(true)
          break

        case "mergeBase":
          setPendingMergeBaseMessage({
            message: `Merge latest from ${baseBranch} into the current branch and resolve any conflicts. Run \`git fetch origin ${baseBranch}\` first, then \`git merge origin/${baseBranch}\`. Resolve any conflicts and commit the merge.`,
            subChatId,
          })
          break

        case "pushBranch":
          pushBranch()
          break

        case "reviewLocal":
          setFilteredSubChatId(subChatId)
          setFilteredDiffFiles(null)
          setDiffSidebarOpen(true)
          setLocalReviewCompleted(true)
          break

        case "reviewPr": {
          try {
            // Switch to the configured Review-mode model FIRST, before the
            // await yields the event loop. This guarantees the model is in
            // place by the time the transport reads it.
            applyModeDefaultModel(subChatId, "review")
            const context = await trpcClient.chats.getPrContext.query({
              chatId,
            })
            if (!context) {
              toast.error("Could not get git context", {
                position: "top-center",
              })
              return
            }
            const message = generateReviewMessage(context)
            setPendingReviewMessage({ message, subChatId })
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : "Failed to start review",
              { position: "top-center" },
            )
          }
          break
        }

        case "createPr":
          setPrCreating(true)
          setPendingPrMessage({
            message:
              "Create a pull request for the current branch. Push any unpushed commits first, then open a PR with a clear title and a summary of the changes in the description.",
            subChatId,
          })
          break

        case "openPr":
          if (prUrl) {
            window.desktopApi.openExternal(prUrl)
          }
          break
      }
    },
    [
      chatId,
      subChatId,
      baseBranch,
      prUrl,
      pushBranch,
      setPlanSidebarOpen,
      setPendingMergeBaseMessage,
      setFilteredSubChatId,
      setFilteredDiffFiles,
      setDiffSidebarOpen,
      setLocalReviewCompleted,
      setPendingReviewMessage,
      setPrCreating,
      setPendingPrMessage,
    ],
  )

  return { dispatch, pushDialog }
}
