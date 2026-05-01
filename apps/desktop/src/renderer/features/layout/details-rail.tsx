import { useCallback, useMemo } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import type { IGridviewPanelProps } from "dockview-react"
import { trpc } from "../../lib/trpc"
import {
  selectedAgentChatIdAtom,
  currentPlanPathAtomFamily,
  workspaceDiffCacheAtomFamily,
  planEditRefetchTriggerAtomFamily,
  subChatModeAtomFamily,
  selectedDiffFilePathAtom,
} from "../agents/atoms"
import { defaultAgentModeAtom } from "../../lib/atoms"
import { useAgentSubChatStore } from "../agents/stores/sub-chat-store"
import { DetailsSidebar } from "../details-sidebar/details-sidebar"
import { useCommitActions } from "../changes/components/commit-input"
import { usePushAction } from "../changes/hooks/use-push-action"
import { useDockApi } from "../dock/dock-context"
import { addOrFocus } from "../dock/add-or-focus"
import {
  useWorkflowActions,
  useWorkflowState,
} from "../agents/hooks/use-workflow-state"
import type { WorkflowActionKind } from "../agents/utils/workflow-state"

/**
 * DetailsRail — gridview right cell. Lifts DetailsSidebar out of ChatView so
 * the summary widgets can live alongside dockview panels (any number of chat
 * / terminal / file panels) instead of being trapped inside one chat's render
 * tree.
 *
 * Reads chatId / activeSubChatId from the global atoms and derives every
 * other prop locally — git status, diff cache, plan path, mode, etc. The
 * widget mutex (useWidgetPanel inside each widget) handles expand-to-panel
 * transitions, so the legacy `onExpand*` callbacks degrade to undefined.
 */
export function DetailsRail(_props: IGridviewPanelProps) {
  const chatId = useAtomValue(selectedAgentChatIdAtom)
  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId)
  const dockApi = useDockApi()

  // Chat record → worktreePath, sandboxId, projectId
  const { data: chat } = trpc.chats.get.useQuery(
    { id: chatId ?? "" },
    { enabled: !!chatId },
  )
  const worktreePath = chat?.worktreePath ?? null
  const sandboxId = (chat as { sandboxId?: string | null } | null)?.sandboxId ?? null
  const meta = (chat as { meta?: { repository?: string; branch?: string | null } } | null)
    ?.meta

  // Plan / mode / refetch trigger (per active sub-chat, falls back to chatId)
  const effectiveSubChatId = activeSubChatId ?? chatId ?? ""
  const planPath = useAtomValue(currentPlanPathAtomFamily(effectiveSubChatId))
  const planRefetchTrigger = useAtomValue(
    planEditRefetchTriggerAtomFamily(effectiveSubChatId),
  )
  const subChatMode = useAtomValue(subChatModeAtomFamily(activeSubChatId ?? ""))
  const defaultMode = useAtomValue(defaultAgentModeAtom)
  const currentMode = activeSubChatId ? subChatMode : defaultMode

  // Diff cache populated by ChatView
  const diffCache = useAtomValue(
    workspaceDiffCacheAtomFamily(chatId ?? ""),
  )

  // Git data — only fetched when there's a worktree
  const { data: branchData } = trpc.changes.getBranches.useQuery(
    { worktreePath: worktreePath ?? "" },
    { enabled: !!worktreePath },
  )
  const {
    data: gitStatus,
    refetch: refetchGitStatus,
    isLoading: isGitStatusLoading,
  } = trpc.changes.getStatus.useQuery(
    { worktreePath: worktreePath ?? "" },
    { enabled: !!worktreePath, staleTime: 30000 },
  )

  const handleCommitRefresh = useCallback(() => {
    refetchGitStatus()
  }, [refetchGitStatus])

  const { commit: commitChanges, isPending: isCommittingChanges } =
    useCommitActions({
      worktreePath: worktreePath ?? null,
      chatId: chatId ?? "",
      onRefresh: handleCommitRefresh,
    })

  const { push: pushBranch, isPending: isPushing } = usePushAction({
    worktreePath: worktreePath ?? null,
    hasUpstream: gitStatus?.hasUpstream ?? true,
    onSuccess: handleCommitRefresh,
  })

  const handleCommit = useCallback(
    (selectedPaths: string[]) => {
      commitChanges({ filePaths: selectedPaths })
    },
    [commitChanges],
  )

  const handleCommitAndPush = useCallback(
    async (selectedPaths: string[]) => {
      const didCommit = await commitChanges({ filePaths: selectedPaths })
      if (didCommit) pushBranch()
    },
    [commitChanges, pushBranch],
  )

  const isCommitting = isCommittingChanges || isPushing
  const canOpenDiff = !!worktreePath
  const setSelectedDiffFilePath = useSetAtom(selectedDiffFilePathAtom)

  const remoteInfo = useMemo(() => {
    if (worktreePath || !sandboxId) return null
    return {
      repository: meta?.repository,
      branch: meta?.branch,
      sandboxId,
    }
  }, [worktreePath, sandboxId, meta?.repository, meta?.branch])

  const handleFileSelect = useCallback(
    (filePath: string) => {
      if (!dockApi || !chatId) return
      setSelectedDiffFilePath(filePath)
      addOrFocus(dockApi, { kind: "diff", data: { chatId } })
    },
    [dockApi, chatId, setSelectedDiffFilePath],
  )

  const handleOpenFile = useCallback(
    (absolutePath: string) => {
      if (!dockApi) return
      addOrFocus(dockApi, { kind: "file", data: { absolutePath } })
    },
    [dockApi],
  )

  // Status widget — workflow state + dispatch
  const workflow = useWorkflowState(chatId, activeSubChatId ?? null)
  const { dispatch: dispatchWorkflowAction, pushDialog } = useWorkflowActions(
    chatId,
    activeSubChatId ?? null,
  )
  const handleWorkflowAction = useCallback(
    (kind: WorkflowActionKind) => {
      void dispatchWorkflowAction(kind)
    },
    [dispatchWorkflowAction],
  )
  const handlePrReview = useCallback(() => {
    void dispatchWorkflowAction("reviewPr")
  }, [dispatchWorkflowAction])

  // Without a chat there's nothing to render.
  if (!chatId) {
    return (
      <div
        className="h-full w-full"
        style={{ paddingLeft: "calc(var(--shell-gap) / 2)" }}
      >
        <div
          className="h-full w-full flex items-center justify-center bg-tl-background border border-border/50 overflow-hidden text-xs text-muted-foreground"
          style={{
            borderRadius: "var(--dv-border-radius)",
            WebkitAppRegion: "no-drag",
          }}
        >
          Select a chat to see details
        </div>
      </div>
    )
  }

  return (
    <div
      className="h-full w-full"
      style={{ paddingLeft: "calc(var(--shell-gap) / 2)" }}
    >
      <div
        className="h-full w-full"
        style={{
          WebkitAppRegion: "no-drag",
        }}
      >
        <DetailsSidebar
          chatId={chatId}
          worktreePath={worktreePath}
          planPath={planPath}
          mode={currentMode}
          planRefetchTrigger={planRefetchTrigger}
          activeSubChatId={activeSubChatId}
          canOpenDiff={canOpenDiff}
          setIsDiffSidebarOpen={() => {
            // Replaced by widget mutex; stubbed.
          }}
          diffStats={diffCache.diffStats}
          parsedFileDiffs={diffCache.parsedFileDiffs}
          onCommit={worktreePath ? handleCommit : undefined}
          onCommitAndPush={worktreePath ? handleCommitAndPush : undefined}
          isCommitting={isCommitting}
          gitStatus={gitStatus ?? null}
          isGitStatusLoading={isGitStatusLoading}
          currentBranch={branchData?.current}
          onFileSelect={handleFileSelect}
          onOpenFile={handleOpenFile}
          remoteInfo={remoteInfo}
          isRemoteChat={!!remoteInfo}
          workflow={workflow}
          onWorkflowAction={handleWorkflowAction}
          onPrReview={handlePrReview}
        />
        {pushDialog}
      </div>
    </div>
  )
}
