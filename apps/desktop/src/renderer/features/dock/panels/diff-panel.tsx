import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { IDockviewPanelProps } from "dockview-react"
import { toast } from "sonner"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { ChangesPanel } from "../../changes/changes-panel"
import {
  AgentDiffView,
  type AgentDiffViewRef,
  diffViewModeAtom,
} from "../../agents/ui/agent-diff-view"
import { DiffSidebarHeader } from "../../changes/components/diff-sidebar-header"
import {
  workspaceDiffCacheAtomFamily,
  agentsChangesPanelWidthAtom,
  diffActiveTabAtom,
  selectedCommitAtom,
  isCreatingPrAtom,
  pendingPrMessageAtom,
  pendingReviewMessageAtom,
  pendingConflictResolutionMessageAtom,
  subChatFilesAtom,
  filteredSubChatIdAtom,
  type SelectedCommit,
} from "../../agents/atoms"
import { useAgentSubChatStore } from "../../agents/stores/sub-chat-store"
import { applyModeDefaultModel } from "../../agents/lib/model-switching"
import {
  generatePrMessage,
  generateReviewMessage,
} from "../../agents/utils/pr-message"
import { usePRStatus } from "../../../hooks/usePRStatus"
import { trpc, trpcClient } from "../../../lib/trpc"
import type {
  ChangeCategory,
  ChangedFile,
} from "../../../../shared/changes-types"
import type { DiffPanelEntity } from "../atoms"
import { useDockApi } from "../dock-context"

/**
 * DiffPanel — full-pane Changes view, mounted as a dockview tab.
 *
 * This is the rich view (file list on the left + line-by-line diff on
 * the right) — equivalent to what the Changes-widget "Open in dialog"
 * action used to render in a center-peek dialog. The dockview tab
 * provides the chrome (title + close), so the panel body skips
 * DiffSidebarHeader and just composes ChangesPanel + AgentDiffView
 * directly.
 *
 * Self-sources its data instead of taking props from active-chat:
 * - `worktreePath` / `sandboxId` / `repository` from `trpc.chats.get`.
 * - `diffStats` / `parsedFileDiffs` / `prefetchedFileContents` from
 *   `workspaceDiffCacheAtomFamily`, populated by ChatView's diff fetcher
 *   (which keeps running while ChatView is mounted in the matching
 *   WorkspaceDockShell).
 * - File / commit / tab selection are component-local state.
 *
 * Action callbacks (commit, create PR, discard, review) are intentionally
 * left as no-ops or thin toasts — those flows have their own UI surfaces
 * in the chat header and chat input, and reproducing them here would mean
 * duplicating a couple hundred lines of mutation glue. The user can
 * commit/PR from the chat side; this panel is for *viewing* changes.
 */
export function DiffPanel({ params }: IDockviewPanelProps<DiffPanelEntity>) {
  const { chatId } = params
  const dockApi = useDockApi()
  const cache = useAtomValue(workspaceDiffCacheAtomFamily(chatId))
  const changesPanelWidth = useAtomValue(agentsChangesPanelWidthAtom)
  const [activeTab, setActiveTab] = useAtom(diffActiveTabAtom)
  const [selectedCommit, setSelectedCommit] = useAtom(selectedCommitAtom)
  const [diffMode, setDiffMode] = useAtom(diffViewModeAtom)

  const trpcUtils = trpc.useUtils()

  const { data: chat } = trpc.chats.get.useQuery(
    { id: chatId },
    { enabled: !!chatId, staleTime: 5_000 },
  )
  const worktreePath = chat?.worktreePath ?? null
  const sandboxId = (chat as { sandboxId?: string } | null | undefined)
    ?.sandboxId ?? null
  const repository = (chat as { repository?: string } | null | undefined)
    ?.repository ?? null

  const { data: branchData } = trpc.changes.getBranches.useQuery(
    { worktreePath: worktreePath ?? "" },
    { enabled: !!worktreePath, staleTime: 30_000 },
  )

  // Clear selectedCommit when the worktree changes — the atom is global so a
  // commit hash from worktree A would otherwise leak into worktree B and
  // surface as a "bad object" git error in getCommitFiles / getCommitFileDiff.
  useEffect(() => {
    setSelectedCommit(null)
  }, [worktreePath, setSelectedCommit])

  const { data: gitStatus, isLoading: isGitStatusLoading } =
    trpc.changes.getStatus.useQuery(
      { worktreePath: worktreePath ?? "" },
      { enabled: !!worktreePath, staleTime: 5_000 },
    )

  const { data: agentChat } = trpc.agents.getAgentChat.useQuery(
    { chatId } as { chatId: string },
    { enabled: !!chatId },
  )

  // Build filter items from sub-chat metadata + the per-sub-chat tracked-file
  // map. Only include sub-chats with at least one tracked file so the toggle
  // and popover stay relevant.
  const subChatFiles = useAtomValue(subChatFilesAtom)
  const subChatsForFilter = useMemo(() => {
    const subs = (agentChat as any)?.subChats ?? []
    return subs
      .map((sc: { id: string; name?: string | null }) => {
        const files = subChatFiles.get(sc.id) ?? []
        return {
          id: sc.id,
          name: sc.name ?? "Conversation",
          filePaths: files.map((f) => f.filePath),
          fileCount: files.length,
        }
      })
      .filter((item: { fileCount: number }) => item.fileCount > 0)
  }, [agentChat, subChatFiles])

  // Active sub-chat — drives the Scoped/All toggle. The store's chatId is
  // set when the user navigates into a chat; for the dockview-promoted panel
  // this will match the panel's chatId when the user is viewing it.
  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId)

  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const handleFileSelect = useCallback(
    (file: ChangedFile, _category: ChangeCategory) => {
      setSelectedFilePath(file.path)
    },
    [],
  )

  // History tab — clicking a commit row selects it, clicking a file
  // inside that commit picks the file path. Both feed back into atoms
  // so AgentDiffView's parsed-diff fetch knows which commit + file to
  // render.
  const handleCommitSelect = useCallback(
    (commit: SelectedCommit) => {
      setSelectedCommit(commit)
    },
    [setSelectedCommit],
  )
  const handleCommitFileSelect = useCallback(
    (file: ChangedFile, _commitHash: string) => {
      setSelectedFilePath(file.path)
    },
    [],
  )
  const handleActiveTabChange = useCallback(
    (tab: "changes" | "history") => {
      setActiveTab(tab)
    },
    [setActiveTab],
  )

  // Refresh the diff cache after user-triggered commit / discard
  // mutations inside ChangesPanel — the panel runs the mutation itself,
  // we just kick the trpc cache so the AgentDiffView picks up the new
  // working-tree state.
  const handleCommitOrDiscardSuccess = useCallback(() => {
    if (!chatId || !worktreePath) return
    void trpcUtils.chats.getParsedDiff.invalidate({ chatId })
    void trpcUtils.changes.getStatus.invalidate({ worktreePath })
  }, [chatId, worktreePath, trpcUtils])

  // Pick a sensible default file to highlight on first paint so the diff
  // view doesn't try to render every file at once.
  const initialSelectedFile = useMemo(() => {
    if (selectedFilePath) return selectedFilePath
    const first = cache.parsedFileDiffs?.[0]
    if (!first) return null
    const candidate =
      first.newPath !== "/dev/null" ? first.newPath : first.oldPath
    return candidate && candidate !== "/dev/null" ? candidate : null
  }, [selectedFilePath, cache.parsedFileDiffs])

  const diffViewRef = useRef<AgentDiffViewRef | null>(null)
  const [viewedCount, setViewedCount] = useState(0)
  const [isReviewing, setIsReviewing] = useState(false)
  const [isCreatingPr, setIsCreatingPr] = useAtom(isCreatingPrAtom)
  const setPendingPrMessage = useSetAtom(pendingPrMessageAtom)
  const setPendingReviewMessage = useSetAtom(pendingReviewMessageAtom)
  const setPendingConflictResolutionMessage = useSetAtom(
    pendingConflictResolutionMessageAtom,
  )

  // PR status drives the Publish / Merge / Fix-conflicts buttons.
  const { pr } = usePRStatus({
    worktreePath: worktreePath ?? undefined,
    enabled: !!worktreePath,
  })
  const hasPrNumber = !!pr?.number
  const isPrOpen = pr?.state === "open"
  const hasMergeConflicts = pr?.mergeable === "CONFLICTING"

  const createPrMutation = trpc.changes.createPR.useMutation({
    onSuccess: () => {
      toast.success("Opening GitHub to create PR...", { position: "top-center" })
      void trpcUtils.changes.getStatus.invalidate({
        worktreePath: worktreePath ?? "",
      })
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create PR", { position: "top-center" })
    },
  })

  const mergePrMutation = trpc.chats.mergePr.useMutation({
    onSuccess: () => {
      toast.success("PR merged successfully!", { position: "top-center" })
      void trpcUtils.chats.getPrStatus.invalidate({ chatId })
    },
    onError: (error) => {
      toast.error(error.message || "Failed to merge PR", { position: "top-center" })
    },
  })

  const handleRefresh = useCallback(() => {
    if (!chatId) return
    void trpcUtils.chats.getParsedDiff.invalidate({ chatId })
    void trpcUtils.changes.getStatus.invalidate({
      worktreePath: worktreePath ?? "",
    })
    void trpcUtils.changes.getBranches.invalidate({
      worktreePath: worktreePath ?? "",
    })
  }, [chatId, trpcUtils, worktreePath])

  // Review — sends a "review the diff" prompt to the active sub-chat.
  // Mirrors active-chat.tsx's handleReview: pulls PR context, switches
  // the sub-chat to the review-mode model, and seeds
  // pendingReviewMessageAtom which ChatViewInner consumes and sends.
  const filteredSubChatIdValue = useAtomValue(filteredSubChatIdAtom)
  const handleReview = useCallback(async () => {
    if (!chatId) return
    setIsReviewing(true)
    try {
      const context = await trpcClient.chats.getPrContext.query({ chatId })
      if (!context) {
        toast.error("Could not get git context", { position: "top-center" })
        return
      }
      const activeSubChatId = useAgentSubChatStore.getState().activeSubChatId
      if (!activeSubChatId) {
        toast.error("No active chat available", { position: "top-center" })
        return
      }
      applyModeDefaultModel(activeSubChatId, "review")
      // Honor the Scoped/All toggle: pass the filtered file list when set.
      const scopedFiles = filteredSubChatIdValue
        ? (subChatFiles.get(filteredSubChatIdValue) ?? [])
            .map((f) => f.displayPath || f.filePath)
            .filter((p): p is string => !!p)
        : []
      const message = generateReviewMessage(
        context,
        scopedFiles.length > 0 ? scopedFiles : undefined,
      )
      setPendingReviewMessage({ message, subChatId: activeSubChatId })
      const chatPanel = dockApi?.getPanel(`chat:${activeSubChatId}`)
      if (chatPanel && !chatPanel.api.isActive) chatPanel.api.setActive()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start review", {
        position: "top-center",
      })
    } finally {
      setIsReviewing(false)
    }
  }, [chatId, dockApi, setPendingReviewMessage, filteredSubChatIdValue, subChatFiles])

  // Create PR — direct mutation (opens GitHub's PR-create page).
  const handleCreatePrDirect = useCallback(async () => {
    if (!worktreePath) {
      toast.error("No workspace path available", { position: "top-center" })
      return
    }
    setIsCreatingPr(true)
    try {
      await createPrMutation.mutateAsync({ worktreePath })
    } finally {
      setIsCreatingPr(false)
    }
  }, [worktreePath, createPrMutation, setIsCreatingPr])

  // Create PR with AI — seeds the pending PR message so the active
  // sub-chat's agent can write the title / body.
  const handleCreatePrWithAI = useCallback(async () => {
    if (!chatId) return
    setIsCreatingPr(true)
    try {
      const activeSubChatId = useAgentSubChatStore.getState().activeSubChatId
      if (!activeSubChatId) {
        toast.error("No active chat available", { position: "top-center" })
        setIsCreatingPr(false)
        return
      }
      const store = useAgentSubChatStore.getState()
      store.addToOpenSubChats(activeSubChatId)
      store.setActiveSubChat(activeSubChatId)
      const context = await trpcClient.chats.getPrContext.query({ chatId })
      if (!context) {
        toast.error("Could not get git context", { position: "top-center" })
        setIsCreatingPr(false)
        return
      }
      const message = generatePrMessage(context)
      setPendingPrMessage({ message, subChatId: activeSubChatId })
      const chatPanel = dockApi?.getPanel(`chat:${activeSubChatId}`)
      if (chatPanel && !chatPanel.api.isActive) chatPanel.api.setActive()
      // isCreatingPr is reset by ChatViewInner once the message is sent.
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to prepare PR request",
        { position: "top-center" },
      )
      setIsCreatingPr(false)
    }
  }, [chatId, dockApi, setPendingPrMessage, setIsCreatingPr])

  const handleMergePr = useCallback(() => {
    mergePrMutation.mutate({ chatId, method: "squash" })
  }, [chatId, mergePrMutation])

  const handleFixConflicts = useCallback(() => {
    const activeSubChatId = useAgentSubChatStore.getState().activeSubChatId
    if (!activeSubChatId) return
    const message = `This PR has merge conflicts with the main branch. Please:

1. First, fetch and merge the latest changes from main branch using git commands
2. If there are any merge conflicts, resolve them carefully by keeping the correct code from both branches
3. After resolving conflicts, commit the merge
4. Push the changes to update the PR

Make sure to preserve all functionality from both branches when resolving conflicts.`
    setPendingConflictResolutionMessage({ message, subChatId: activeSubChatId })
    const chatPanel = dockApi?.getPanel(`chat:${activeSubChatId}`)
    if (chatPanel && !chatPanel.api.isActive) chatPanel.api.setActive()
  }, [dockApi, setPendingConflictResolutionMessage])

  const handleExpandAll = useCallback(() => {
    diffViewRef.current?.expandAll()
  }, [])
  const handleCollapseAll = useCallback(() => {
    diffViewRef.current?.collapseAll()
  }, [])
  const handleMarkAllViewed = useCallback(() => {
    diffViewRef.current?.markAllViewed()
    if (diffViewRef.current) setViewedCount(diffViewRef.current.getViewedCount())
  }, [])
  const handleMarkAllUnviewed = useCallback(() => {
    diffViewRef.current?.markAllUnviewed()
    if (diffViewRef.current) setViewedCount(diffViewRef.current.getViewedCount())
  }, [])

  if (!worktreePath || !chatId) {
    return (
      <div className="h-full w-full flex items-center justify-center text-muted-foreground text-sm">
        No worktree available
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background">
      <DiffSidebarHeader
        worktreePath={worktreePath}
        currentBranch={branchData?.current ?? ""}
        diffStats={
          cache.diffStats ?? {
            isLoading: false,
            hasChanges: false,
            fileCount: 0,
            additions: 0,
            deletions: 0,
          }
        }
        sidebarWidth={typeof window !== "undefined" ? window.innerWidth : 1200}
        pushCount={gitStatus?.pushCount ?? 0}
        pullCount={gitStatus?.pullCount ?? 0}
        hasUpstream={gitStatus?.hasUpstream ?? true}
        isSyncStatusLoading={isGitStatusLoading}
        aheadOfDefault={gitStatus?.ahead ?? 0}
        behindDefault={gitStatus?.behind ?? 0}
        onReview={handleReview}
        isReviewing={isReviewing}
        onCreatePr={handleCreatePrDirect}
        isCreatingPr={isCreatingPr}
        onCreatePrWithAI={handleCreatePrWithAI}
        isCreatingPrWithAI={isCreatingPr}
        onMergePr={handleMergePr}
        isMergingPr={mergePrMutation.isPending}
        hasPrNumber={hasPrNumber}
        isPrOpen={isPrOpen}
        hasMergeConflicts={hasMergeConflicts}
        onFixConflicts={handleFixConflicts}
        // No onClose — dockview tab's X handles closing.
        onRefresh={handleRefresh}
        onExpandAll={handleExpandAll}
        onCollapseAll={handleCollapseAll}
        viewMode={diffMode}
        onViewModeChange={setDiffMode}
        viewedCount={viewedCount}
        onMarkAllViewed={handleMarkAllViewed}
        onMarkAllUnviewed={handleMarkAllUnviewed}
        // Display-mode chrome belongs to dockview now — pass full-page so
        // the header doesn't render its own mode-switcher buttons.
        displayMode="full-page"
      />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: file list / commits */}
        <div
          className="h-full flex-shrink-0 border-r border-border/50"
          style={{ width: changesPanelWidth, borderRightWidth: "0.5px" }}
        >
          <ChangesPanel
            worktreePath={worktreePath}
            activeTab={activeTab}
            selectedFilePath={selectedFilePath}
            onFileSelect={handleFileSelect}
            onFileOpenPinned={() => {}}
            subChats={subChatsForFilter}
            activeSubChatId={activeSubChatId}
            chatId={chatId}
            selectedCommitHash={selectedCommit?.hash}
            onCommitSelect={handleCommitSelect}
            onCommitFileSelect={handleCommitFileSelect}
            onActiveTabChange={handleActiveTabChange}
            onCommitSuccess={handleCommitOrDiscardSuccess}
            onDiscardSuccess={handleCommitOrDiscardSuccess}
            onCreatePr={handleCreatePrDirect}
            pushCount={gitStatus?.pushCount ?? 0}
          />
        </div>
        {/* Right: line-by-line diff for the selected file */}
        <div className="flex-1 min-w-0 h-full overflow-hidden">
          <AgentDiffView
            ref={diffViewRef}
            chatId={chatId}
            sandboxId={sandboxId ?? ""}
            worktreePath={worktreePath}
            repository={repository ?? undefined}
            initialDiff={cache.diffContent}
            initialParsedFiles={cache.parsedFileDiffs}
            prefetchedFileContents={cache.prefetchedFileContents ?? {}}
            showFooter={false}
            initialSelectedFile={initialSelectedFile}
            onViewedCountChange={setViewedCount}
          />
        </div>
      </div>
    </div>
  )
}
