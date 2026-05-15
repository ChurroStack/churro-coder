import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Terminal } from '@/features/terminal/terminal';
import { trpc } from '@/lib/trpc';
import { HarnessIcon, HARNESS_LABELS, type Harness } from '../lib/harness-icons';
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
import { useStuckDetection } from '../hooks/use-stuck-detection';
import { StallIcon, StallBanner } from './stall-banner';

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
  const [showHardResetDialog, setShowHardResetDialog] = useState(false);
  const [hardResetClearScrollback, setHardResetClearScrollback] = useState(false);

  const killMutation = trpc.terminal.kill.useMutation();
  const clearScrollbackMutation = trpc.terminal.clearScrollback.useMutation();

  const buildBootstrapMutation = trpc.chats.buildCliBootstrap.useMutation({
    onSuccess: (result: unknown) => {
      if (result && typeof result === 'object' && 'kind' in result) {
        const err = result as { kind: string; message: string; hint?: string };
        setBootstrapState({ status: 'error', kind: err.kind, message: err.message, hint: err.hint });
      } else {
        setBootstrapState({ status: 'ready', bootstrap: result as TerminalBootstrapConfig });
      }
    },
    onError: (err: { message: string }) => {
      setBootstrapState({ status: 'error', kind: 'unknown', message: err.message });
    }
  });

  const doBootstrap = useCallback(
    (trigger: 'initial' | 'reattach' = 'initial') => {
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
        chatId
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
    setHardResetClearScrollback(false);
    setBootstrapState({ status: 'idle' });
  };

  const paneId = `cli:${subChatId}`;
  const label = HARNESS_LABELS[harness];
  const ptyActive = bootstrapState.status === 'ready';
  const [showStallBanner, setShowStallBanner] = useState(false);

  useStuckDetection({ subChatId, harness, paneId, ptyActive });

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
      {/* Harness header badge */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border flex-shrink-0">
        <HarnessIcon harness={harness} size={14} />
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <div className="ml-auto flex items-center gap-1">
          <StallIcon subChatId={subChatId} onExpand={() => setShowStallBanner(true)} />
          <button
            data-testid="hard-reset-button"
            onClick={() => isOwner && setShowHardResetDialog(true)}
            disabled={!isOwner}
            title="Hard-reset session"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <RotateCcw size={12} />
          </button>
        </div>
      </div>

      {/* Stall advisory banner */}
      {showStallBanner && (
        <StallBanner
          subChatId={subChatId}
          onHardReset={() => {
            setShowStallBanner(false);
            void doHardReset();
          }}
        />
      )}

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

      {/* Body: disconnected / loading / error / terminal */}
      <div className="flex-1 overflow-hidden relative">
        {/* Terminal always mounts once ready, stays mounted for scrollback */}
        {bootstrapState.status === 'ready' && (
          <Terminal paneId={paneId} cwd={cwd} bootstrap={bootstrapState.bootstrap} />
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
    </div>
  );
}
