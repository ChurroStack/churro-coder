import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Terminal } from '@/features/terminal/terminal';
import { trpc } from '@/lib/trpc';
import { HARNESS_LABELS, type Harness } from '../lib/harness-icons';
import type { TerminalBootstrapConfig } from '@/features/terminal/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useStuckDetection } from '../hooks/use-stuck-detection';
import { markMcpInjected, forgetMcpInjected } from '../hooks/use-harness-send-dispatcher';
import { useCliAutoRenameOnFirstMessage } from '../hooks/use-cli-auto-rename-on-first-message';
import {
  subChatHardResetDialogOpenAtomFamily,
  subChatCliRestartHandlerAtomFamily,
  pendingUserQuestionsAtom,
  subChatFilesAtom,
  cliBusyAtomFamily,
  cliSplitLayoutAtomFamily,
  cliSplitSizeAtomFamily
} from '../atoms';
import { CliConversationPane } from './cli-conversation-pane';
import type { PendingUserQuestion } from '../atoms';
import { AgentUserQuestion } from './agent-user-question';
import { SubChatStatusCard } from './sub-chat-status-card';
import { useWorkflowState, useWorkflowActions } from '../hooks/use-workflow-state';
import type { WorkflowActionKind } from '../utils/workflow-state';

interface ChatCliSurfaceProps {
  subChatId: string;
  harness: Harness;
  /** Workspace/chat ID — lets the server resolve cwd from the chat row directly when the subChat row is missing (e.g. after a DB wipe while dockview layout persists). */
  chatId?: string;
  /** Working directory for the PTY. Defaults to '~'. */
  cwd?: string;
  /** Whether this panel is the currently active dockview panel. */
  isActive?: boolean;
  /** Whether this panel should be visible / mounted. */
  shouldMountContent?: boolean;
  /**
   * Start in the disconnected state (restored after app restart).
   * No PTY spawns until the user clicks "Reattach". The xterm scrollback
   * from the prior session is still visible behind the banner.
   */
  startDisconnected?: boolean;
  /**
   * Whether this window owns the subChat. When false, bootstrap is disabled
   * and the surface shows a read-only state. Defaults to true for backwards
   * compatibility (single-window usage).
   */
  isOwner?: boolean;
  /**
   * Whether the cwd prop has been resolved from the DB query. Bootstrap is
   * deferred until true so the CLI starts in the correct project directory
   * rather than the home dir on first open. Defaults to true for callers
   * that don't need to resolve cwd dynamically.
   */
  cwdReady?: boolean;
}

type BootstrapState =
  | { status: 'idle' }
  | { status: 'disconnected' }
  | { status: 'loading' }
  | { status: 'ready'; bootstrap: TerminalBootstrapConfig }
  | { status: 'error'; kind: string; message: string; hint?: string };

const REATTACH_BANNER =
  'Session ended on restart — Reattach (new CLI session; ask it to read the current plan to continue)';

/**
 * ChatCliSurface — the embedded terminal surface for CLI-harness subChats.
 *
 * Routing rule (specs/chat-surface-router/spec.md):
 *   harness='claude-cli' | 'codex-cli' + openspecChangeId=null → main area
 *   harness='claude-cli' | 'codex-cli' + openspecChangeId=<id> → sidebar slot
 *
 * The PTY pane id is `cli:<subChatId>` — stable, one-to-one with the subChat.
 * Bootstrap is fetched once via tRPC on first mount; the Terminal component
 * uses it to spawn the correct binary with MCP config injected.
 *
 * After app restart, pass `startDisconnected={true}` to mount in a disconnected
 * state (scrollback visible, Reattach banner overlaid). No PTY spawns until
 * the user clicks Reattach.
 */
export function ChatCliSurface({
  subChatId,
  harness,
  chatId,
  cwd = '~',
  shouldMountContent = true,
  startDisconnected = false,
  isOwner = true,
  cwdReady = true
}: ChatCliSurfaceProps) {
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>(
    startDisconnected ? { status: 'disconnected' } : { status: 'idle' }
  );

  // First-user-message auto-rename. Subscribed to the JSONL ingester so it
  // covers both voice-dispatched and TUI-typed first messages.
  useCliAutoRenameOnFirstMessage(subChatId, chatId);

  const [showHardResetDialog, setShowHardResetDialog] = useAtom(subChatHardResetDialogOpenAtomFamily(subChatId));
  const [hardResetClearScrollback, setHardResetClearScrollback] = useState(false);
  const [pendingQuestions, setPendingQuestions] = useAtom(pendingUserQuestionsAtom);
  const pendingQuestion = pendingQuestions.get(subChatId);

  const resolveCliUserQuestion = trpc.chats.resolveCliUserQuestion.useMutation();

  // Note: this `cliUserQuestion` subscription is mounted per-panel. CLI chat
  // panels opt into dockview's `renderer='always'` (see add-or-focus.ts and
  // chat-panel.tsx's setRenderer effect), so the panel — and this subscription
  // — stay mounted across tab switches and the missed-event class is covered.
  // Cross-window broadcast (same subChat open in two windows) is still
  // out-of-scope; if that becomes a requirement, move this to a global mirror
  // similar to <CliStateSubscriber/>.
  trpc.chats.cliUserQuestion.useSubscription(subChatId, {
    onData: (event) => {
      const entry = event as { requestId: string; subChatId: string; questions: PendingUserQuestion['questions'] };
      console.log(`[chat-cli-surface] cliUserQuestion sub=${subChatId} requestId=${entry.requestId}`);
      setPendingQuestions((prev) => {
        const next = new Map(prev);
        next.set(subChatId, {
          subChatId,
          parentChatId: chatId ?? '',
          toolUseId: entry.requestId,
          questions: entry.questions,
          source: 'cli',
          requestId: entry.requestId
        });
        return next;
      });
    }
  });

  const handleCliAnswer = useCallback(
    (answers: Record<string, string>) => {
      if (!pendingQuestion?.requestId) return;
      resolveCliUserQuestion.mutate({ requestId: pendingQuestion.requestId, answers });
      setPendingQuestions((prev) => {
        const next = new Map(prev);
        next.delete(subChatId);
        return next;
      });
    },
    [pendingQuestion, resolveCliUserQuestion, setPendingQuestions, subChatId]
  );

  const handleCliSkip = useCallback(() => {
    if (!pendingQuestion?.requestId) return;
    resolveCliUserQuestion.mutate({ requestId: pendingQuestion.requestId, skip: true });
    setPendingQuestions((prev) => {
      const next = new Map(prev);
      next.delete(subChatId);
      return next;
    });
  }, [pendingQuestion, resolveCliUserQuestion, setPendingQuestions, subChatId]);

  const killMutation = trpc.terminal.kill.useMutation();
  const clearScrollbackMutation = trpc.terminal.clearScrollback.useMutation();

  // Per-sub-chat file scoping (subChatFilesAtom) is seeded centrally by
  // useSubChatFilesSync in the always-mounted DetailsRail, which re-seeds on
  // every files-changed event — so no per-surface tracking is needed here.

  const buildBootstrapMutation = trpc.chats.buildCliBootstrap.useMutation({
    onSuccess: (result: unknown) => {
      if (result && typeof result === 'object' && 'kind' in result) {
        const err = result as { kind: string; message: string; hint?: string };
        setBootstrapState({ status: 'error', kind: err.kind, message: err.message, hint: err.hint });
      } else {
        const bootstrap = result as TerminalBootstrapConfig;
        // If buildBootstrap already prepended the MCP reminder to the first PTY
        // chunk (plan mode w/ an initial user message), seed the dispatcher's
        // "already injected" set so dispatch() doesn't re-inject on message #2.
        if (bootstrap?.mcpReminderInjected) {
          markMcpInjected(subChatId);
        }
        setBootstrapState({ status: 'ready', bootstrap });
      }
    },
    onError: (err: { message: string }) => {
      setBootstrapState({ status: 'error', kind: 'unknown', message: err.message });
    }
  });

  const doBootstrap = useCallback(
    (trigger: 'initial' | 'reattach' | 'hard-reset' | 'restart' = 'initial') => {
      setBootstrapState({ status: 'loading' });
      const cwdArg = cwd !== '~' ? cwd : undefined;
      console.log(
        `[chat-cli-surface] bootstrap subChat=${subChatId} trigger=${trigger} cwd_prop=${cwd} cwd_arg=${cwdArg ?? '(omitted)'}`
      );
      if (trigger === 'reattach') {
        console.log(`[resilience] subChat=${subChatId} event=reattach`);
      }
      buildBootstrapMutation.mutate({
        subChatId,
        harness: harness as 'claude-cli' | 'codex-cli',
        cwd: cwdArg,
        chatId,
        trigger
      });
    },
    [subChatId, harness, cwd, buildBootstrapMutation]
  );

  const doHardReset = async () => {
    setShowHardResetDialog(false);
    console.log(`[resilience] subChat=${subChatId} event=hard-reset`);
    try {
      await killMutation.mutateAsync({ paneId });
    } catch {
      // PTY may already be dead; proceed with respawn regardless
    }
    if (hardResetClearScrollback) {
      try {
        await clearScrollbackMutation.mutateAsync({ paneId });
      } catch {
        // Non-fatal
      }
    }
    // Clear the "MCP reminder already injected" tracker so the next bootstrap
    // re-seeds it correctly (or the dispatcher re-injects if no initial msg).
    forgetMcpInjected(subChatId);
    setHardResetClearScrollback(false);
    // Call directly with 'hard-reset' trigger so the server skips prompt re-injection.
    // Bypassing the 'idle' state avoids the useEffect firing with trigger='initial'.
    doBootstrap('hard-reset');
  };

  const paneId = `cli:${subChatId}`;
  const label = HARNESS_LABELS[harness];
  const ptyActive = bootstrapState.status === 'ready';

  const setCliRestartHandler = useSetAtom(useMemo(() => subChatCliRestartHandlerAtomFamily(subChatId), [subChatId]));

  // Register a restart handler so CliPromptBar can trigger kill + re-inject.
  useEffect(() => {
    const handler = async () => {
      console.log(`[resilience] subChat=${subChatId} event=cli-restart`);
      try {
        await killMutation.mutateAsync({ paneId });
      } catch {
        // PTY may already be dead; proceed with respawn regardless
      }
      forgetMcpInjected(subChatId);
      doBootstrap('restart');
    };
    setCliRestartHandler(() => handler);
    return () => setCliRestartHandler(null);
  }, [subChatId, paneId, killMutation, doBootstrap, setCliRestartHandler]);

  useStuckDetection({ subChatId, harness, paneId, ptyActive });

  // On panel unmount (subChat closed, dock removed the panel, app quit),
  // drop the MCP-injection tracking for this subChat so a future panel mount
  // re-injects the reminder on its first message. Matches the lifecycle of
  // the cli:<subChatId> PTY — both die when the panel goes away.
  useEffect(() => {
    return () => {
      forgetMcpInjected(subChatId);
    };
  }, [subChatId]);

  // When the PTY exits (process crashed, user ran /exit, etc.) the next user
  // keystroke triggers a renderer-side restartTerminal() that spawns a fresh
  // PTY without re-running buildBootstrap. That fresh session is a new
  // conversation and the MCP reminder needs to be re-injected on its first
  // message — but the module-level mcpInjectedSessions Set still says "done".
  // Clear it here so submitToCli re-injects on the next user message.
  trpc.terminal.stream.useSubscription(paneId, {
    onData: (event) => {
      if (event.type === 'exit') {
        forgetMcpInjected(subChatId);
      }
    },
    enabled: !!subChatId
  });

  // Workflow notch — same atoms/dispatcher the builtin status card uses.
  // Mounted between the terminal body and the pending-question slot so it
  // sits just above the CLI prompt input (also covers the OpenSpec sidebar
  // mount automatically since this surface is the sidebar's CLI host).
  const workflow = useWorkflowState(chatId ?? null, subChatId);
  const {
    dispatch: dispatchWorkflowAction,
    pushDialog: workflowPushDialog,
    isActionPending
  } = useWorkflowActions(chatId ?? null, subChatId);
  const isNextActionPending = workflow?.next ? !!isActionPending[workflow.next.actionKind] : false;
  const cliBusy = useAtomValue(useMemo(() => cliBusyAtomFamily(subChatId), [subChatId]));
  const subChatFiles = useAtomValue(subChatFilesAtom);
  const changedFiles = useMemo(() => subChatFiles.get(subChatId) ?? [], [subChatFiles, subChatId]);
  const handleNotchAction = useCallback(
    (kind: WorkflowActionKind) => {
      console.log(`[cli-notch] subChat=${subChatId} harness=${harness} action=${kind} outcome=invoked`);
      void dispatchWorkflowAction(kind);
    },
    [dispatchWorkflowAction, subChatId, harness]
  );
  const worktreePath = cwd !== '~' ? cwd : undefined;

  // Trigger bootstrap when entering idle state with owner + resolved cwd. Kept in
  // an effect so a StrictMode double-render doesn't fire the mutation twice (which
  // would double-write the Claude config file).
  useEffect(() => {
    if (bootstrapState.status === 'idle' && isOwner && cwdReady) {
      doBootstrap('initial');
    }
  }, [bootstrapState.status, isOwner, cwdReady, doBootstrap]);

  if (!shouldMountContent) return null;

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-background" data-testid="chat-cli-surface">
      {/* Hard-reset confirm dialog */}
      <AlertDialog open={showHardResetDialog} onOpenChange={setShowHardResetDialog}>
        <AlertDialogContent className="w-[360px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset {label} session?</AlertDialogTitle>
            <AlertDialogDescription>
              The current process will be terminated and a new session started. Message history is preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 py-1">
            <Checkbox
              id="hard-reset-clear-scrollback"
              checked={hardResetClearScrollback}
              onCheckedChange={(v) => setHardResetClearScrollback(v === true)}
            />
            <label htmlFor="hard-reset-clear-scrollback" className="text-sm cursor-pointer select-none">
              Clear scrollback too
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doHardReset}>Reset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Body: disconnected / loading / error / terminal (+ optional split) */}
      <div className="flex-1 overflow-hidden relative">
        {/* Terminal always mounts once ready, stays mounted for scrollback.
            When the conversation pane is enabled, the Terminal is wrapped in a
            resizable split. Critical: the <Terminal /> element keeps a stable
            React key so the xterm/PTY does not remount on layout changes
            (xterm state is paneId-scoped — remount = lose alt-screen + signals
            to running processes like htop).

            workspaceId={chatId} is required so the main-process session
            records the parent chat id — the global <CliStateSubscriber/>
            reads it back via terminal.allCliStates to populate
            loadingSubChatsAtom (Map<subChatId, parentChatId>) so the chats
            sidebar workspace spinner lights up. CliSplitBody threads it to
            both Terminal mounts (with-pane and layout='off'). */}
        {bootstrapState.status === 'ready' && (
          <CliSplitBody
            subChatId={subChatId}
            chatId={chatId ?? ''}
            paneId={paneId}
            cwd={cwd}
            workspaceId={chatId}
            bootstrap={bootstrapState.bootstrap}
          />
        )}

        {bootstrapState.status === 'loading' && (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Starting {label}…</div>
        )}

        {bootstrapState.status === 'disconnected' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center bg-background/90 backdrop-blur-sm">
            <p className="text-sm text-muted-foreground max-w-sm">{REATTACH_BANNER}</p>
            <button
              data-testid="cli-reattach-button"
              onClick={() => doBootstrap('reattach')}
              className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
              Reattach
            </button>
          </div>
        )}

        {bootstrapState.status === 'error' && (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-4 text-center">
            <p className="text-sm text-destructive font-medium">{bootstrapState.message}</p>
            {bootstrapState.hint && <p className="text-xs text-muted-foreground font-mono">{bootstrapState.hint}</p>}
            <button
              onClick={() => setBootstrapState({ status: 'idle' })}
              className="text-xs underline text-muted-foreground hover:text-foreground">
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Workflow notch — same widget used above the builtin chat textarea.
          The card hides itself when there's nothing actionable (no next step,
          no changed files, not busy) so it doesn't add visual weight at rest. */}
      {chatId && (
        <div className="px-2 -mb-6 relative z-10">
          <div className="w-full max-w-5xl mx-auto px-2">
            <SubChatStatusCard
              chatId={chatId}
              subChatId={subChatId}
              isStreaming={cliBusy}
              changedFiles={changedFiles}
              worktreePath={worktreePath}
              workflow={workflow}
              isNextActionPending={isNextActionPending}
              onWorkflowAction={handleNotchAction}
            />
          </div>
        </div>
      )}

      {/* Push dialog hosted by useWorkflowActions (mounts on REMOTE_AHEAD). */}
      {workflowPushDialog}

      {/* User question widget — appears above CliPromptBar when request_user_input is active */}
      {pendingQuestion && pendingQuestion.source === 'cli' && (
        <div className="px-4">
          <AgentUserQuestion pendingQuestions={pendingQuestion} onAnswer={handleCliAnswer} onSkip={handleCliSkip} />
        </div>
      )}
    </div>
  );
}

/**
 * Split body — the conversation pane sits beside (or above) the terminal,
 * resizable, with the layout persisted per-subChat. When the user disables the
 * pane (layout='off'), only the terminal renders. The Terminal element keeps
 * a stable React position so xterm never remounts on layout changes.
 *
 * Library/our terminology mapping:
 *   our 'vertical'   = panes side-by-side = react-resizable-panels direction="horizontal"
 *   our 'horizontal' = panes stacked       = react-resizable-panels direction="vertical"
 */
function CliSplitBody({
  subChatId,
  chatId,
  paneId,
  cwd,
  workspaceId,
  bootstrap
}: {
  subChatId: string;
  chatId: string;
  paneId: string;
  cwd?: string;
  workspaceId?: string;
  bootstrap: TerminalBootstrapConfig;
}) {
  const layout = useAtomValue(cliSplitLayoutAtomFamily(subChatId));
  const [chatSize, setChatSize] = useAtom(cliSplitSizeAtomFamily(subChatId));
  const statusQuery = trpc.cliSession.getStatus.useQuery(
    { subChatId },
    { refetchInterval: 5_000, refetchOnWindowFocus: false }
  );
  const sessionFileLabel = useMemo(() => {
    const f = statusQuery.data?.sessionFile;
    if (!f) return null;
    const i = f.lastIndexOf('/');
    return i === -1 ? f : f.slice(i + 1);
  }, [statusQuery.data?.sessionFile]);

  if (layout === 'off') {
    return (
      <Terminal
        paneId={paneId}
        cwd={cwd}
        workspaceId={workspaceId}
        bootstrap={bootstrap}
        clearScrollbackOnColChange={harness === 'claude-cli'}
      />
    );
  }

  // See terminology mapping in this function's doc comment.
  const direction = layout === 'vertical' ? 'horizontal' : 'vertical';

  return (
    <ResizablePanelGroup
      direction={direction}
      onLayout={(sizes) => {
        if (Array.isArray(sizes) && typeof sizes[0] === 'number') setChatSize(sizes[0]);
      }}>
      <ResizablePanel defaultSize={chatSize} minSize={15} order={1} id={`cli-chat-${subChatId}`}>
        <CliConversationPane subChatId={subChatId} chatId={chatId} sessionFileLabel={sessionFileLabel} />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={100 - chatSize} minSize={15} order={2} id={`cli-term-${subChatId}`}>
        <Terminal
          paneId={paneId}
          cwd={cwd}
          workspaceId={workspaceId}
          bootstrap={bootstrap}
          clearScrollbackOnColChange={harness === 'claude-cli'}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
