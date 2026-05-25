import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type { IGridviewPanelProps } from 'dockview-react';
import { trpc } from '../../lib/trpc';
import { api } from '../../lib/mock-api';
import {
  selectedAgentChatIdAtom,
  currentPlanPathAtomFamily,
  workspaceDiffCacheAtomFamily,
  planEditRefetchTriggerAtomFamily,
  selectedDiffFilePathAtom
} from '../agents/atoms';
import { useSubChatMode } from '../agents/hooks/use-sub-chat-mode';
import { defaultAgentModeAtom } from '../../lib/atoms';
import { useAgentSubChatStore } from '../agents/stores/sub-chat-store';
import { DetailsSidebar } from '../details-sidebar/details-sidebar';
import { useCommitActions } from '../changes/components/commit-input';
import { usePushAction } from '../changes/hooks/use-push-action';
import { useDockApi } from '../dock/dock-context';
import { addOrFocus } from '../dock/add-or-focus';
import { useWorkflowActions, useWorkflowState } from '../agents/hooks/use-workflow-state';
import type { WorkflowActionKind } from '../agents/utils/workflow-state';

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
  const chatId = useAtomValue(selectedAgentChatIdAtom);
  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId);
  const openSubChatIds = useAgentSubChatStore((s) => s.openSubChatIds);
  const dockApi = useDockApi();

  // Chat record → worktreePath, sandboxId, projectId.
  // Uses api.agents.getAgentChat (via mock-api) which validates the tRPC response
  // and falls back to window.desktopApi.getAgentChatSnapshot on startup IPC poisoning.
  const { data: chat } = api.agents.getAgentChat.useQuery({ chatId: chatId ?? '' }, { enabled: !!chatId });
  const worktreePath = chat?.worktreePath ?? null;
  const sandboxId = (chat as { sandboxId?: string | null } | null)?.sandboxId ?? null;
  const meta = (chat as { meta?: { repository?: string; branch?: string | null } } | null)?.meta;

  const mountTimeRef = useRef(performance.now());
  const lastLoggedRef = useRef<string | null>(null);
  useEffect(() => {
    const sinceMountMs = Math.round(performance.now() - mountTimeRef.current);
    const chatKeys = chat && typeof chat === 'object' ? Object.keys(chat as object).slice(0, 8) : null;
    const signature = JSON.stringify({
      chatId: chatId ?? null,
      chatIsUndefined: chat === undefined,
      chatIsNull: chat === null,
      chatHasIdString: !!(chat && typeof (chat as { id?: unknown }).id === 'string'),
      chatHasSubChatsArray: Array.isArray((chat as { subChats?: unknown } | null | undefined)?.subChats),
      chatKeys,
      worktreePath: chat?.worktreePath ?? null
    });
    if (signature === lastLoggedRef.current) return;
    lastLoggedRef.current = signature;
    console.log('[DetailsRail] chat-record state', { sinceMountMs, ...JSON.parse(signature) });
  }, [chat, chatId]);

  // Plan / mode / refetch trigger (per active sub-chat).
  //
  // Fallback ladder when activeSubChatId is null:
  //   1. First open sub-chat for this chat (covers the cold-mount race where
  //      ChatPanel hasn't pushed activeSubChatId into the store yet but the
  //      sub-chat is mounted under its own subChatId). All artifact files
  //      live under <userData>/sub-chats/<subChatId>/, so reading from
  //      `chatId` here returns exists:false and the widget stays empty.
  //   2. chatId — last-resort for chats with no open sub-chats yet.
  const effectiveSubChatId = activeSubChatId ?? openSubChatIds[0] ?? chatId ?? '';
  const planPath = useAtomValue(currentPlanPathAtomFamily(effectiveSubChatId));
  const planRefetchTrigger = useAtomValue(planEditRefetchTriggerAtomFamily(effectiveSubChatId));
  const setCurrentPlanPath = useSetAtom(currentPlanPathAtomFamily(effectiveSubChatId));
  const triggerPlanRefetch = useSetAtom(planEditRefetchTriggerAtomFamily(effectiveSubChatId));

  // Cold-start hydration: currentPlanPathAtomFamily is in-memory only, so on
  // app restart the Plan widget would render empty even though the MCP plan
  // file is on disk. Seed the atom from getCurrentPlan whenever the local
  // path is null. Dedupes with the same query fired by useWorkflowSnapshot.
  const { data: currentPlanData } = trpc.chats.getCurrentPlan.useQuery(
    { subChatId: effectiveSubChatId },
    { enabled: !!effectiveSubChatId }
  );
  useEffect(() => {
    if (!planPath && currentPlanData?.exists && currentPlanData.filePath) {
      console.log(`[DetailsRail] plan-path-hydrated sub=${effectiveSubChatId} path=${currentPlanData.filePath}`);
      setCurrentPlanPath(currentPlanData.filePath);
    }
  }, [currentPlanData, planPath, setCurrentPlanPath, effectiveSubChatId]);

  const trpcUtils = trpc.useUtils();

  // Aggressive cache invalidation on sub-chat / chat / worktree switches.
  // Trades one round-trip per switch for guaranteed fresh widget data and
  // no stale-flash on tab toggles. Explicitly OK'd by the user.
  useEffect(() => {
    if (!effectiveSubChatId) return;
    void trpcUtils.chats.getCurrentPlan.invalidate({ subChatId: effectiveSubChatId });
    void trpcUtils.chats.getCurrentTasks.invalidate({ subChatId: effectiveSubChatId });
    void trpcUtils.chats.getCurrentReview.invalidate({ subChatId: effectiveSubChatId });
    void trpcUtils.chats.getReviewContent.invalidate({ subChatId: effectiveSubChatId });
    void trpcUtils.chats.getMcpFileChanges.invalidate({ subChatId: effectiveSubChatId });
    console.log(`[DetailsRail] switch-invalidate sub=${effectiveSubChatId}`);
  }, [effectiveSubChatId, trpcUtils]);
  useEffect(() => {
    if (!chatId) return;
    void trpcUtils.chats.getPrStatus.invalidate({ chatId });
    void trpcUtils.chats.get.invalidate({ id: chatId });
    console.log(`[DetailsRail] switch-invalidate chat=${chatId}`);
  }, [chatId, trpcUtils]);
  useEffect(() => {
    if (!worktreePath) return;
    void trpcUtils.changes.getStatus.invalidate({ worktreePath });
    void trpcUtils.changes.getBranches.invalidate({ worktreePath });
    console.log(`[DetailsRail] switch-invalidate worktree=${worktreePath}`);
  }, [worktreePath, trpcUtils]);

  // Central sidebar refresh: fires on write_plan, write_tasks, update_task_status,
  // or write_review from any sub-chat under this chat. Subscribing at the
  // chat level (not sub-chat) keeps the stream alive across activeSubChatId
  // changes and survives the cold-mount race where activeSubChatId is still
  // null but the panel's own subChatId is the one writing artifacts.
  trpc.chats.artifactWrittenForChat.useSubscription(chatId ?? '', {
    enabled: !!chatId,
    onData({ subChatId: eventSubChatId, kind, filePath }) {
      // Set the plan-path atom only when the event matches the currently
      // visible sub-chat — that's the only widget that consumes this key
      // right now. Other sub-chats pick up their plan via cold-start
      // hydration the next time their key becomes effective (the query
      // invalidation below makes that read fresh).
      if (kind === 'plan' && filePath && eventSubChatId === effectiveSubChatId) {
        setCurrentPlanPath(filePath);
        triggerPlanRefetch();
      }
      // Invalidate per-sub-chat queries keyed by the event's exact subChatId
      // so any widget mounted under that key picks up fresh data on its
      // next read, regardless of whether activeSubChatId matches.
      void trpcUtils.chats.getCurrentPlan.invalidate({ subChatId: eventSubChatId });
      void trpcUtils.chats.getCurrentTasks.invalidate({ subChatId: eventSubChatId });
      void trpcUtils.chats.getCurrentReview.invalidate({ subChatId: eventSubChatId });
      void trpcUtils.chats.getReviewContent.invalidate({ subChatId: eventSubChatId });
      if (kind === 'files-changed') {
        void trpcUtils.chats.getMcpFileChanges.invalidate({ subChatId: eventSubChatId });
      }
      if (chatId) {
        void trpcUtils.chats.getPrStatus.invalidate({ chatId });
        void trpcUtils.chats.get.invalidate({ id: chatId });
      }
      console.log(`[DetailsRail] artifact-written kind=${kind} sub=${eventSubChatId} effective=${effectiveSubChatId}`);
    }
  });
  const { mode: subChatMode } = useSubChatMode(activeSubChatId ?? '');
  const defaultMode = useAtomValue(defaultAgentModeAtom);
  const currentMode = activeSubChatId ? subChatMode : defaultMode;

  // Diff cache populated by ChatView
  const diffCache = useAtomValue(workspaceDiffCacheAtomFamily(chatId ?? ''));

  // Git data — only fetched when there's a worktree
  const { data: branchData } = trpc.changes.getBranches.useQuery(
    { worktreePath: worktreePath ?? '' },
    { enabled: !!worktreePath }
  );
  const {
    data: gitStatus,
    refetch: refetchGitStatus,
    isLoading: isGitStatusLoading
  } = trpc.changes.getStatus.useQuery(
    { worktreePath: worktreePath ?? '' },
    { enabled: !!worktreePath, staleTime: 30000, refetchOnMount: 'always' }
  );
  // Dedup'd against useWorkflowState's own subscription below — used purely
  // as a cold-load fallback for hasUpstream (see the Push action wiring).
  const { data: prStatusData } = trpc.chats.getPrStatus.useQuery(
    { chatId: chatId ?? '' },
    { enabled: !!chatId, refetchInterval: 30000 }
  );

  const handleCommitRefresh = useCallback(() => {
    refetchGitStatus();
  }, [refetchGitStatus]);

  const { commit: commitChanges, isPending: isCommittingChanges } = useCommitActions({
    worktreePath: worktreePath ?? null,
    chatId: chatId ?? '',
    onRefresh: handleCommitRefresh
  });

  const { push: pushBranch, isPending: isPushing } = usePushAction({
    worktreePath: worktreePath ?? null,
    // Cold-load asymmetric-fallback fix: a PR (live or DB-backed) proves the
    // branch has an upstream, so we trust it before gitStatus resolves rather
    // than defaulting to either polarity. `?? true` previously caused first
    // pushes on a freshly opened workspace to be sent without `-u`, which
    // silently fails the user's first push. See
    // docs/postmortems/2026-05-status-widget-amber-flash-on-load.md.
    hasUpstream:
      gitStatus?.hasUpstream ?? (!!prStatusData?.pr || !!(chat as { prNumber?: number | null } | null)?.prNumber),
    onSuccess: handleCommitRefresh
  });

  const handleCommit = useCallback(
    (selectedPaths: string[]) => {
      commitChanges({ filePaths: selectedPaths });
    },
    [commitChanges]
  );

  const handleCommitAndPush = useCallback(
    async (selectedPaths: string[]) => {
      const didCommit = await commitChanges({ filePaths: selectedPaths });
      if (didCommit) pushBranch();
    },
    [commitChanges, pushBranch]
  );

  const isCommitting = isCommittingChanges || isPushing;
  const canOpenDiff = !!worktreePath;
  const setSelectedDiffFilePath = useSetAtom(selectedDiffFilePathAtom);

  const remoteInfo = useMemo(() => {
    if (worktreePath || !sandboxId) return null;
    return {
      repository: meta?.repository,
      branch: meta?.branch,
      sandboxId
    };
  }, [worktreePath, sandboxId, meta?.repository, meta?.branch]);

  const handleFileSelect = useCallback(
    (filePath: string) => {
      if (!dockApi || !chatId) return;
      setSelectedDiffFilePath(filePath);
      addOrFocus(dockApi, { kind: 'diff', data: { chatId } });
    },
    [dockApi, chatId, setSelectedDiffFilePath]
  );

  const handleOpenFile = useCallback(
    (absolutePath: string) => {
      if (!dockApi) return;
      addOrFocus(dockApi, {
        kind: 'file',
        data: { absolutePath, subChatId: activeSubChatId ?? undefined }
      });
    },
    [dockApi, activeSubChatId]
  );

  // Status widget — workflow state + dispatch
  // Use the same fallback ladder as effectiveSubChatId above — passing null
  // when activeSubChatId is null collapses to IDLE_WORKFLOW_STATE (all 'idle',
  // gray icons, no spinner), which hides CLI-busy on cold mount.
  const workflowSubChatId = activeSubChatId ?? openSubChatIds[0] ?? null;
  const workflow = useWorkflowState(chatId, workflowSubChatId);
  const { dispatch: dispatchWorkflowAction, pushDialog } = useWorkflowActions(chatId, workflowSubChatId);
  const handleWorkflowAction = useCallback(
    (kind: WorkflowActionKind) => {
      void dispatchWorkflowAction(kind);
    },
    [dispatchWorkflowAction]
  );
  const handlePrReview = useCallback(() => {
    void dispatchWorkflowAction('reviewPr');
  }, [dispatchWorkflowAction]);

  // Without a chat there's nothing to render.
  if (!chatId) {
    return (
      <div className="h-full w-full" style={{ paddingLeft: 'calc(var(--shell-gap) / 2)' }}>
        <div
          className="h-full w-full flex items-center justify-center bg-tl-background border border-border/50 overflow-hidden text-xs text-muted-foreground"
          style={{
            borderRadius: 'var(--dv-border-radius)',
            WebkitAppRegion: 'no-drag'
          }}>
          Select a chat to see details
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full" style={{ paddingLeft: 'calc(var(--shell-gap) / 2)' }}>
      <div
        className="h-full w-full"
        style={{
          WebkitAppRegion: 'no-drag'
        }}>
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
  );
}
