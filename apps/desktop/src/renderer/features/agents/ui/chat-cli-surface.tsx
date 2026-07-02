import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
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
  expiredUserQuestionsAtom,
  subChatFilesAtom,
  cliBusyAtomFamily,
  cliSplitLayoutAtomFamily,
  cliSplitSizeAtomFamily,
  defaultPlanModeModelAtom,
  defaultExecuteModeModelAtom,
  advisorEnabledAtom,
  advisorModeModelAtom
} from '../atoms';
import { computeOpusplanCommand } from '../lib/models';
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
   * Start in the disconnected state (restored after app restart). No PTY spawns
   * until the user clicks "Reattach". The Reattach prompt is scoped to the
   * terminal pane; the conversation pane keeps rendering the persisted
   * transcript beside it.
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
 * state — the Reattach prompt fills the terminal pane while the conversation
 * pane still renders the persisted transcript. No PTY spawns until the user
 * clicks Reattach.
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
  const store = useStore();
  const [pendingQuestions, setPendingQuestions] = useAtom(pendingUserQuestionsAtom);
  const pendingQuestion = pendingQuestions.get(subChatId);
  const [expiredQuestions, setExpiredQuestions] = useAtom(expiredUserQuestionsAtom);
  const expiredQuestion = expiredQuestions.get(subChatId);
  // Prefer the live question; fall back to an expired one (disabled, "the agent
  // may ask again"). Mirrors the builtin/Codex surface.
  const displayQuestion = pendingQuestion ?? expiredQuestion;
  const isQuestionExpired = !pendingQuestion && !!expiredQuestion;

  const resolveCliUserQuestion = trpc.chats.resolveCliUserQuestion.useMutation();

  const seedPendingQuestion = useCallback(
    (requestId: string, questions: PendingUserQuestion['questions']) => {
      setPendingQuestions((prev) => {
        if (prev.get(subChatId)?.requestId === requestId) return prev;
        const next = new Map(prev);
        next.set(subChatId, {
          subChatId,
          parentChatId: chatId ?? '',
          toolUseId: requestId,
          questions,
          source: 'cli',
          requestId
        });
        return next;
      });
      // A fresh question supersedes any expired one still on screen.
      setExpiredQuestions((prev) => {
        if (!prev.has(subChatId)) return prev;
        const next = new Map(prev);
        next.delete(subChatId);
        return next;
      });
    },
    [chatId, setPendingQuestions, setExpiredQuestions, subChatId]
  );

  // Move the currently-displayed question to the disabled "Expired" state, but
  // ONLY if it is still the one on screen (guard by requestId read from the
  // store, not a captured snapshot) — a late expiry for a superseded question
  // must not expire the fresh one that replaced it. Two independent setters, no
  // side effect nested inside a state updater.
  const moveToExpired = useCallback(
    (requestId: string) => {
      const current = store.get(pendingUserQuestionsAtom).get(subChatId);
      if (!current || current.requestId !== requestId) return;
      setPendingQuestions((prev) => {
        if (prev.get(subChatId)?.requestId !== requestId) return prev;
        const next = new Map(prev);
        next.delete(subChatId);
        return next;
      });
      setExpiredQuestions((prev) => {
        const next = new Map(prev);
        next.set(subChatId, current);
        return next;
      });
    },
    [store, subChatId, setPendingQuestions, setExpiredQuestions]
  );

  // Rehydrate an outstanding question when the panel mounts after the one-shot
  // cliUserQuestion event already fired (close→reopen, renderer cold start).
  // Keyed on subChatId (not a per-mount boolean) so a reused panel instance
  // whose subChatId changes still rehydrates the new sub-chat's question.
  const rehydratedSubChatRef = useRef<string | null>(null);
  const pendingQuestionQuery = trpc.chats.getPendingCliQuestion.useQuery(subChatId, { staleTime: 0 });
  useEffect(() => {
    if (rehydratedSubChatRef.current === subChatId) return;
    const data = pendingQuestionQuery.data;
    if (data === undefined) return; // still loading
    rehydratedSubChatRef.current = subChatId;
    if (!data) return; // no outstanding question
    console.log(`[chat-cli-surface] rehydrate sub=${subChatId} requestId=${data.requestId}`);
    seedPendingQuestion(data.requestId, data.questions);
  }, [pendingQuestionQuery.data, subChatId, seedPendingQuestion]);

  // Note: these subscriptions are mounted per-panel. CLI chat panels opt into
  // dockview's `renderer='always'` (see add-or-focus.ts and chat-panel.tsx's
  // setRenderer effect), so the panel — and these subscriptions — stay mounted
  // across tab switches and the missed-event class is covered. Cross-window
  // broadcast (same subChat open in two windows) is still out-of-scope; if that
  // becomes a requirement, move this to a global mirror like <CliStateSubscriber/>.
  trpc.chats.cliUserQuestion.useSubscription(subChatId, {
    onData: (event) => {
      const entry = event as { requestId: string; subChatId: string; questions: PendingUserQuestion['questions'] };
      console.log(`[chat-cli-surface] cliUserQuestion sub=${subChatId} requestId=${entry.requestId}`);
      seedPendingQuestion(entry.requestId, entry.questions);
    }
  });

  // The question expired (host backstop or claude-code abandoned the call):
  // move it to the disabled "Expired" state. Guard on requestId so a late
  // expiry for a superseded question can't expire the fresh one.
  trpc.chats.cliUserQuestionExpired.useSubscription(subChatId, {
    onData: (event) => {
      const ev = event as { requestId: string; subChatId: string };
      console.log(`[chat-cli-surface] cliUserQuestionExpired sub=${subChatId} requestId=${ev.requestId}`);
      moveToExpired(ev.requestId);
    }
  });

  // The question was cleared (teardown / supersede): remove the widget outright.
  trpc.chats.cliUserQuestionCleared.useSubscription(subChatId, {
    onData: (event) => {
      const ev = event as { requestId: string; subChatId: string };
      console.log(`[chat-cli-surface] cliUserQuestionCleared sub=${subChatId} requestId=${ev.requestId}`);
      setPendingQuestions((prev) => {
        const current = prev.get(subChatId);
        if (!current || current.requestId !== ev.requestId) return prev;
        const next = new Map(prev);
        next.delete(subChatId);
        return next;
      });
      setExpiredQuestions((prev) => {
        const current = prev.get(subChatId);
        if (!current || current.requestId !== ev.requestId) return prev;
        const next = new Map(prev);
        next.delete(subChatId);
        return next;
      });
    }
  });

  const clearPending = useCallback(
    (requestId: string) => {
      setPendingQuestions((prev) => {
        if (prev.get(subChatId)?.requestId !== requestId) return prev;
        const next = new Map(prev);
        next.delete(subChatId);
        return next;
      });
    },
    [setPendingQuestions, subChatId]
  );

  const submitCliResolution = useCallback(
    async (payload: { answers?: Record<string, string>; skip?: boolean }) => {
      const question = pendingQuestion;
      if (!question?.requestId) return;
      try {
        const res = await resolveCliUserQuestion.mutateAsync({ requestId: question.requestId, ...payload });
        if (res.ok) {
          clearPending(question.requestId);
        } else {
          // Already resolved/expired on the host — the answer did NOT reach the
          // agent. Surface it as expired instead of silently clearing (no-op if
          // a newer question already superseded this one).
          console.warn(`[chat-cli-surface] resolve not-ok sub=${subChatId} reason=${res.reason}`);
          moveToExpired(question.requestId);
        }
      } catch (err) {
        console.error(`[chat-cli-surface] resolve failed sub=${subChatId}`, err);
        moveToExpired(question.requestId);
      }
    },
    [pendingQuestion, resolveCliUserQuestion, clearPending, moveToExpired, subChatId]
  );

  const handleCliAnswer = useCallback(
    (answers: Record<string, string>) => {
      void submitCliResolution({ answers });
    },
    [submitCliResolution]
  );

  const handleCliSkip = useCallback(() => {
    void submitCliResolution({ skip: true });
  }, [submitCliResolution]);

  // Dismiss an expired question (it's no longer answerable; the agent may re-ask).
  const handleExpiredDismiss = useCallback(() => {
    setExpiredQuestions((prev) => {
      if (!prev.has(subChatId)) return prev;
      const next = new Map(prev);
      next.delete(subChatId);
      return next;
    });
  }, [setExpiredQuestions, subChatId]);

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

  // Default-mode + advisor settings drive the Claude CLI bootstrap sequence
  // (see chats.buildCliBootstrap). Read here (renderer localStorage atoms) and
  // pass the derived commands to the main process, which can't see these.
  const defaultPlanModel = useAtomValue(defaultPlanModeModelAtom);
  const defaultExecuteModel = useAtomValue(defaultExecuteModeModelAtom);
  const advisorEnabled = useAtomValue(advisorEnabledAtom);
  const advisorModeModel = useAtomValue(advisorModeModelAtom);

  const doBootstrap = useCallback(
    (trigger: 'initial' | 'reattach' | 'hard-reset' | 'restart' = 'initial') => {
      setBootstrapState({ status: 'loading' });
      const cwdArg = cwd !== '~' ? cwd : undefined;
      // Claude CLI only: `/model opusplan` when Plan=Opus & Execute=Sonnet, and
      // `/advisor <model>` when the Advisor mode is enabled. Both are ignored
      // by the main process for codex-cli.
      const isClaudeCli = harness === 'claude-cli';
      const claudeModelCommand = isClaudeCli
        ? computeOpusplanCommand(defaultPlanModel, defaultExecuteModel)
        : undefined;
      const advisorModel = isClaudeCli && advisorEnabled ? advisorModeModel : undefined;
      console.log(
        `[chat-cli-surface] bootstrap subChat=${subChatId} trigger=${trigger} cwd_prop=${cwd} cwd_arg=${cwdArg ?? '(omitted)'} modelCmd=${claudeModelCommand ?? '(none)'} advisor=${advisorModel ?? '(off)'}`
      );
      if (trigger === 'reattach') {
        console.log(`[resilience] subChat=${subChatId} event=reattach`);
      }
      buildBootstrapMutation.mutate({
        subChatId,
        harness: harness as 'claude-cli' | 'codex-cli',
        cwd: cwdArg,
        chatId,
        trigger,
        ...(claudeModelCommand ? { claudeModelCommand } : {}),
        ...(advisorModel ? { advisorModel } : {})
      });
    },
    [
      subChatId,
      harness,
      cwd,
      chatId,
      buildBootstrapMutation,
      defaultPlanModel,
      defaultExecuteModel,
      advisorEnabled,
      advisorModeModel
    ]
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

  // Single restart definition for a CLI pane — kill the PTY, drop the
  // MCP-injection tracking, then rebootstrap with trigger='restart' (which
  // re-spawns the correct binary and re-sends the first user message). Used by
  // BOTH the Restart button (via the registered atom handler) and the
  // in-terminal "[Press any key to restart]" affordance (via onExitedKeyPress),
  // so the two never diverge.
  const runCliRestart = useCallback(async () => {
    console.log(`[resilience] subChat=${subChatId} event=cli-restart`);
    try {
      await killMutation.mutateAsync({ paneId });
    } catch {
      // PTY may already be dead; proceed with respawn regardless
    }
    forgetMcpInjected(subChatId);
    doBootstrap('restart');
  }, [subChatId, paneId, killMutation, doBootstrap]);

  // Register the restart handler so CliPromptBar's button can trigger it.
  useEffect(() => {
    setCliRestartHandler(() => runCliRestart);
    return () => setCliRestartHandler(null);
  }, [runCliRestart, setCliRestartHandler]);

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
    reopenDialog: workflowReopenDialog,
    archiveDialog: workflowArchiveDialog,
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

  // Terminal-pane content, swapped by bootstrap state. The conversation pane
  // (CliSplitBody → CliConversationPane, fed by the persisted messages table)
  // stays mounted across every state — only this terminal-side slot changes, so
  // the Reattach prompt / loading / error are scoped to the terminal pane while
  // the chat transcript stays visible (including while detached after restart).
  // Plain (not memoized): the ready-state <Terminal> reconciles in place by its
  // stable panel position, so xterm/PTY survive re-renders without a memo.
  const terminalSlot: ReactNode = (() => {
    switch (bootstrapState.status) {
      case 'ready':
        return (
          <Terminal
            paneId={paneId}
            cwd={cwd}
            workspaceId={chatId}
            bootstrap={bootstrapState.bootstrap}
            onExitedKeyPress={() => void runCliRestart()}
            clearScrollbackOnColChange={harness === 'claude-cli'}
          />
        );
      case 'loading':
        return (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Starting {label}…</div>
        );
      case 'disconnected':
        return (
          <div className="h-full w-full flex flex-col items-center justify-center gap-3 p-4 text-center">
            <p className="text-sm text-muted-foreground max-w-sm">{REATTACH_BANNER}</p>
            <button
              data-testid="cli-reattach-button"
              onClick={() => doBootstrap('reattach')}
              className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
              Reattach
            </button>
          </div>
        );
      case 'error':
        return (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-4 text-center">
            <p className="text-sm text-destructive font-medium">{bootstrapState.message}</p>
            {bootstrapState.hint && <p className="text-xs text-muted-foreground font-mono">{bootstrapState.hint}</p>}
            <button
              onClick={() => setBootstrapState({ status: 'idle' })}
              className="text-xs underline text-muted-foreground hover:text-foreground">
              Retry
            </button>
          </div>
        );
      case 'idle':
      default:
        return null;
    }
  })();

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

      {/* Body: the conversation pane (from the persisted messages table) always
          renders; only the terminal-side slot swaps with bootstrap state (see
          `terminalSlot` above), so Reattach / loading / error stay scoped to the
          terminal pane and the chat transcript is always visible.

          The ready-state <Terminal> in `terminalSlot` passes workspaceId={chatId}
          so the main-process session records the parent chat id — the global
          <CliStateSubscriber/> reads it back via terminal.allCliStates to
          populate loadingSubChatsAtom so the chats sidebar workspace spinner
          lights up. CliSplitBody renders the slot at a stable position (panel 2,
          id=cli-term-<subChatId>) so xterm/PTY never remount on layout changes. */}
      <div className="flex-1 overflow-hidden relative">
        <CliSplitBody subChatId={subChatId} chatId={chatId ?? ''} ptyActive={ptyActive} terminalSlot={terminalSlot} />
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
              actionPending={isActionPending}
              onWorkflowAction={handleNotchAction}
            />
          </div>
        </div>
      )}

      {/* Push dialog hosted by useWorkflowActions (mounts on REMOTE_AHEAD). */}
      {workflowPushDialog}
      {/* Re-open-branch + Archive confirm dialogs (merged-branch terminal state). */}
      {workflowReopenDialog}
      {workflowArchiveDialog}

      {/* User question widget — appears above CliPromptBar when request_user_input is active.
          When expired it stays visible but disabled ("the agent may ask again"). */}
      {displayQuestion && displayQuestion.source === 'cli' && (
        <div className="px-4">
          <AgentUserQuestion
            pendingQuestions={displayQuestion}
            onAnswer={handleCliAnswer}
            onSkip={isQuestionExpired ? handleExpiredDismiss : handleCliSkip}
            expired={isQuestionExpired}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Split body — the read-only conversation pane sits beside (or above) the
 * terminal-side slot, resizable, with the layout persisted per-subChat. The
 * conversation pane renders from the persisted messages table and is therefore
 * independent of the live PTY, so it stays mounted in every bootstrap state;
 * the parent swaps `terminalSlot` (live Terminal / Reattach prompt / loading /
 * error) without remounting the chat. When the user disables the pane
 * (layout='off'), only the slot renders. The slot keeps a stable React position
 * (panel 2) so the ready-state xterm never remounts on layout changes.
 *
 * Library/our terminology mapping:
 *   our 'vertical'   = panes side-by-side = react-resizable-panels direction="horizontal"
 *   our 'horizontal' = panes stacked       = react-resizable-panels direction="vertical"
 */
function CliSplitBody({
  subChatId,
  chatId,
  ptyActive,
  terminalSlot
}: {
  subChatId: string;
  chatId: string;
  ptyActive: boolean;
  terminalSlot: ReactNode;
}) {
  const layout = useAtomValue(cliSplitLayoutAtomFamily(subChatId));
  const [chatSize, setChatSize] = useAtom(cliSplitSizeAtomFamily(subChatId));
  // Only poll while the PTY is live — the session-file label can't change while
  // detached, so a restored-but-not-reattached panel must not poll every 5 s.
  // The one-shot initial fetch still runs, so the label shows from the prior
  // session; refetch-on-invalidate (terminal events) still applies when live.
  const statusQuery = trpc.cliSession.getStatus.useQuery(
    { subChatId },
    { refetchInterval: ptyActive ? 5_000 : false, refetchOnWindowFocus: false }
  );
  const sessionFileLabel = useMemo(() => {
    const f = statusQuery.data?.sessionFile;
    if (!f) return null;
    const i = f.lastIndexOf('/');
    return i === -1 ? f : f.slice(i + 1);
  }, [statusQuery.data?.sessionFile]);

  // Self-heal: if this CLI sub-chat has a claimed session but no ingester is
  // watching (the post-spawn locator missed its single shot, so the transcript
  // was never parsed into the messages table), kick the idempotent,
  // deterministic-only server recovery once per mount. This is the automatic
  // version of the status-widget Refresh button — the server no-ops when there's
  // nothing to attach, and never mtime-scans (no cross-latch risk).
  const utils = trpc.useUtils();
  const ensureAttached = trpc.cliSession.ensureAttached.useMutation();
  const selfHealedRef = useRef<string | null>(null);
  const statusReady = statusQuery.isSuccess;
  const statusHarness = statusQuery.data?.harness ?? null;
  const statusWatching = statusQuery.data?.watching ?? false;
  const statusSessionId = statusQuery.data?.sessionId ?? null;
  useEffect(() => {
    if (!statusReady || !statusHarness) return; // non-CLI rows return harness=null
    if (statusWatching || !statusSessionId) return; // already attached, or nothing to recover
    if (selfHealedRef.current === subChatId) return; // once per mounted sub-chat
    selfHealedRef.current = subChatId;
    ensureAttached.mutate(
      { subChatId },
      {
        onSuccess: (res) => {
          if (res.attached) {
            void utils.cliSession.getStatus.invalidate({ subChatId });
            void utils.messages.getLatest.invalidate({ subChatId });
          }
        },
        // Best-effort; the manual Refresh button remains the escape hatch.
        onError: () => {}
      }
    );
  }, [statusReady, statusHarness, statusWatching, statusSessionId, subChatId, ensureAttached, utils]);

  if (layout === 'off') {
    return <>{terminalSlot}</>;
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
        {terminalSlot}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
