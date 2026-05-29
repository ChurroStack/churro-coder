import { EventEmitter } from 'node:events';
import { FALLBACK_SHELL, SHELL_CRASH_THRESHOLD_MS } from './env';
import { portManager } from './port-manager';
import { getProcessTree } from './port-scanner';
import { createSession, setupInitialCommands } from './session';
import type { CliStateEvent, CreateSessionParams, SessionResult, TerminalOutputState, TerminalSession } from './types';

/**
 * Idle-detection tuning. Each session that opts in samples activity every
 * windowMs. A window is "active" if it saw any cursor moves on the
 * @xterm/headless mirror OR any raw PTY bytes. The dual signal matters:
 * Claude/Codex sometimes emit bytes (hide cursor, write spinner glyph in
 * place, restore) that don't move the cursor, AND sometimes go quiet for
 * a second or two mid-thinking with no bytes at all. Combining both
 * signals plus hysteresis below makes the running state stable.
 *
 * - windowMs: sampler tick interval.
 * - runningWindowsRequired: consecutive active windows needed to flip
 *   idle→running. 2 × 1s requires ~1–2s of sustained activity, which
 *   defangs single-burst false positives (TUI repaint after a SIGWINCH).
 *   Real CLI work has the spinner ticking every ~100ms so every window is
 *   active during work.
 * - idleWindowsRequired: consecutive inactive windows needed to flip
 *   running→idle. 4 × 1s = 4s of true silence — covers thinking pauses
 *   while still feeling responsive when the model actually stops.
 * - resizeSuppressMs: how long after a real geometry change we ignore the
 *   activity sampler. Covers the SIGWINCH → TUI repaint burst.
 */
const IDLE_TUNING = {
  windowMs: 1000,
  runningWindowsRequired: 2,
  idleWindowsRequired: 4,
  resizeSuppressMs: 1500
} as const;

type KillSignal = 'SIGTERM' | 'SIGKILL' | 'SIGINT' | 'SIGHUP';

/**
 * Kill the entire process tree rooted at the pty's shell.
 *
 * `pty.kill()` only signals the shell; long-lived children spawned inside the
 * shell (e.g. `bun run dev` -> `vite` -> `node`) often survive because they
 * either disowned themselves or live in a child process group. Walk the tree
 * with pidtree, signal each descendant, then signal the shell via the pty.
 *
 * Errors are swallowed: pids may have already exited (ESRCH), and we never
 * want kill failures to block the larger shutdown / kill flow.
 */
async function killProcessTree(session: TerminalSession, signal: KillSignal = 'SIGTERM'): Promise<void> {
  const rootPid = session.pty.pid;
  let descendants: number[] = [];
  if (rootPid) {
    try {
      const tree = await getProcessTree(rootPid);
      descendants = tree.filter((pid) => pid !== rootPid);
    } catch {
      // pidtree may fail if the root already exited; fall back to pty-only kill.
    }
  }

  // Signal leaves first so parents don't respawn children.
  for (const pid of descendants.reverse()) {
    try {
      process.kill(pid, signal);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code && code !== 'ESRCH') {
        console.warn(`[TerminalManager] Failed to ${signal} descendant pid ${pid}:`, err);
      }
    }
  }

  try {
    session.pty.kill(signal);
  } catch (err) {
    console.warn(`[TerminalManager] pty.kill(${signal}) failed:`, err);
  }
}

export class TerminalManager extends EventEmitter {
  private sessions = new Map<string, TerminalSession>();
  private pendingSessions = new Map<string, Promise<SessionResult>>();

  async createOrAttach(params: CreateSessionParams): Promise<SessionResult> {
    const { paneId, cols, rows } = params;

    // Deduplicate concurrent calls (prevents race in React Strict Mode)
    const pending = this.pendingSessions.get(paneId);
    if (pending) {
      return pending;
    }

    // Return existing session if alive
    const existing = this.sessions.get(paneId);
    if (existing?.isAlive) {
      existing.lastActive = Date.now();
      if (cols !== undefined && rows !== undefined) {
        this.resize({ paneId, cols, rows });
      }
      return {
        isNew: false,
        serializedState: existing.serializedState || ''
      };
    }

    // Create new session
    const creationPromise = this.doCreateSession(params);
    this.pendingSessions.set(paneId, creationPromise);

    try {
      return await creationPromise;
    } finally {
      this.pendingSessions.delete(paneId);
    }
  }

  private async doCreateSession(params: CreateSessionParams & { useFallbackShell?: boolean }): Promise<SessionResult> {
    const { paneId, workspaceId, initialCommands } = params;

    // Create the session
    const session = await createSession(params, (id, data) => {
      this.emit(`data:${id}`, data);
      const target = this.sessions.get(id);
      if (!target?.idleDetection) return;
      // Activity-meter signal #1: raw PTY byte volume. Counts even when the
      // TUI rewrites in place without moving the cursor (claude's spinner
      // does this — hide cursor, overwrite glyph at the same column, show).
      target.pendingBytes = (target.pendingBytes ?? 0) + data.length;
      // Activity-meter signal #2: cursor moves on the headless mirror — fed
      // by writing the same chunk into the parser. onCursorMove counts how
      // many positions the TUI actually re-positioned to.
      if (target.headlessTerminal) {
        try {
          target.headlessTerminal.write(data);
        } catch (err) {
          console.warn(`[TerminalManager] headlessTerminal.write failed for ${id}:`, err);
        }
      }
    });

    // Set up initial commands (only for new sessions)
    setupInitialCommands(session, initialCommands);

    // Set up exit handler with fallback logic
    this.setupExitHandler(session, params);

    // Wire activity tracking when the bootstrap opts in
    if (params.bootstrap?.idleDetection) {
      this.startActivityTracking(session);
    }

    this.sessions.set(paneId, session);

    portManager.registerSession(session, workspaceId || '');

    return {
      isNew: true,
      serializedState: ''
    };
  }

  /**
   * Only place that mutates session.outputState. Skips the emit when the
   * incoming value matches the current one, so subscribers never see
   * idle→idle or running→running events.
   *
   * In addition to the per-pane `state:${paneId}` event, fires a multiplexed
   * `cli-state` event for `cli:*` panes so a single global subscriber can mirror
   * every CLI sub-chat's busy state without binding to a specific pane id.
   */
  private transitionTo(session: TerminalSession, next: TerminalOutputState): void {
    if (session.outputState === next) return;
    session.outputState = next;
    this.emit(`state:${session.paneId}`, next);
    if (session.paneId.startsWith('cli:')) {
      const subChatId = session.paneId.slice('cli:'.length);
      const evt: CliStateEvent = {
        subChatId,
        parentChatId: session.workspaceId || null,
        state: next
      };
      this.emit('cli-state', evt);
      console.log(`[terminal-cli-state] sub=${subChatId} state=${next}`);
    }
  }

  /**
   * Enumerate alive `cli:*` sessions for the initial snapshot delivered to
   * late subscribers of `terminal.allCliStates`. A session that never enabled
   * `idleDetection` has no `outputState` — default to `idle` rather than
   * leak `undefined` through the wire.
   */
  listActiveCliSessions(): Array<{
    subChatId: string;
    parentChatId: string | null;
    state: TerminalOutputState;
  }> {
    const out: Array<{ subChatId: string; parentChatId: string | null; state: TerminalOutputState }> = [];
    for (const [paneId, session] of this.sessions) {
      if (!paneId.startsWith('cli:') || !session.isAlive) continue;
      out.push({
        subChatId: paneId.slice('cli:'.length),
        // Coerce empty-string workspaceId to null so the renderer sidebars
        // never try to look up workspace id ''.
        parentChatId: session.workspaceId || null,
        state: session.outputState ?? 'idle'
      });
    }
    return out;
  }

  private startActivityTracking(session: TerminalSession): void {
    session.outputState = 'idle';
    session.pendingMoves = 0;
    session.pendingBytes = 0;
    session.recentMoves = [];

    if (session.headlessTerminal) {
      session.headlessTerminal.onCursorMove(() => {
        session.pendingMoves = (session.pendingMoves ?? 0) + 1;
      });
    }

    session.idleSamplerInterval = setInterval(() => this.evaluateWindow(session.paneId), IDLE_TUNING.windowMs);
    session.idleSamplerInterval.unref();
  }

  private evaluateWindow(paneId: string): void {
    const session = this.sessions.get(paneId);
    if (!session?.isAlive || !session.idleDetection) return;

    const moves = session.pendingMoves ?? 0;
    const bytes = session.pendingBytes ?? 0;
    session.pendingMoves = 0;
    session.pendingBytes = 0;

    // Post-resize suppression: drain counters but preserve the ring and
    // current state. The SIGWINCH-driven TUI repaint produces a one-shot
    // burst of bytes/cursor moves that we don't want to mis-classify as
    // running. Preserving the ring (instead of pushing 0) also avoids
    // biasing a currently-running session toward premature idle if the
    // user drag-resizes mid-stream.
    if (session.suppressActivityUntil !== undefined && Date.now() < session.suppressActivityUntil) {
      return;
    }

    // Window is "active" if EITHER the headless parser saw a cursor move
    // OR the PTY pushed any bytes through. Either signal alone is enough
    // to keep the session in running.
    const active = moves > 0 || bytes > 0 ? 1 : 0;

    const ring = session.recentMoves ?? [];
    const ringLimit = Math.max(IDLE_TUNING.runningWindowsRequired, IDLE_TUNING.idleWindowsRequired);
    ring.push(active);
    if (ring.length > ringLimit) ring.shift();
    session.recentMoves = ring;

    if (session.outputState === 'idle') {
      // Need N consecutive active windows at the tail of the ring.
      const need = IDLE_TUNING.runningWindowsRequired;
      if (ring.length < need) return;
      for (let i = ring.length - need; i < ring.length; i++) {
        if (ring[i] !== 1) return;
      }
      this.transitionTo(session, 'running');
    } else {
      // Need N consecutive inactive windows at the tail of the ring.
      const need = IDLE_TUNING.idleWindowsRequired;
      if (ring.length < need) return;
      for (let i = ring.length - need; i < ring.length; i++) {
        if (ring[i] !== 0) return;
      }
      this.transitionTo(session, 'idle');
    }
  }

  private teardownActivityTracking(session: TerminalSession): void {
    if (session.idleSamplerInterval) {
      clearInterval(session.idleSamplerInterval);
      session.idleSamplerInterval = undefined;
    }
    if (session.headlessTerminal) {
      try {
        session.headlessTerminal.dispose();
      } catch (err) {
        console.warn(`[TerminalManager] headlessTerminal.dispose failed for ${session.paneId}:`, err);
      }
      session.headlessTerminal = undefined;
    }
  }

  /** Snapshot of the current state for late subscribers (tRPC `state` sub). */
  getOutputState(paneId: string): TerminalOutputState | null {
    const session = this.sessions.get(paneId);
    if (!session?.idleDetection) return null;
    return session.outputState ?? 'idle';
  }

  private setupExitHandler(
    session: TerminalSession,
    params: CreateSessionParams & { useFallbackShell?: boolean }
  ): void {
    const { paneId } = params;

    session.pty.onExit(async ({ exitCode, signal }) => {
      session.isAlive = false;
      this.teardownActivityTracking(session);

      // Check if shell crashed quickly - try fallback. Skip when the user
      // asked us to kill this session: SIGKILL/SIGTERM look like a "crash"
      // (non-zero exit, short duration) but we must not resurrect.
      const sessionDuration = Date.now() - session.startTime;
      const crashedQuickly = sessionDuration < SHELL_CRASH_THRESHOLD_MS && exitCode !== 0;

      if (crashedQuickly && !session.usedFallback && !session.intentionalKill) {
        console.warn(
          `[TerminalManager] Shell "${session.shell}" exited with code ${exitCode} after ${sessionDuration}ms, retrying with fallback shell "${FALLBACK_SHELL}"`
        );

        if (this.sessions.get(paneId) === session) {
          this.sessions.delete(paneId);
        }

        try {
          await this.doCreateSession({
            ...params,
            useFallbackShell: true
          });
          return; // Recovered - don't emit exit
        } catch (fallbackError) {
          console.error('[TerminalManager] Fallback shell also failed:', fallbackError);
        }
      }

      // Unregister from port manager (also removes detected ports)
      portManager.unregisterSession(paneId);

      this.emit(`exit:${paneId}`, exitCode, signal);

      // Multiplexed cli-state event so the global renderer subscriber can purge
      // the entry from its map without needing the per-pane state subscription.
      if (paneId.startsWith('cli:')) {
        const subChatId = paneId.slice('cli:'.length);
        const evt: CliStateEvent = {
          subChatId,
          parentChatId: session.workspaceId || null,
          state: 'exited'
        };
        this.emit('cli-state', evt);
        console.log(`[terminal-cli-state] sub=${subChatId} state=exited`);
      }

      // Clean up session after delay. Capture the session ref so we don't
      // accidentally evict a fresh session that took over this paneId.
      const timeout = setTimeout(() => {
        if (this.sessions.get(paneId) === session) {
          this.sessions.delete(paneId);
        }
      }, 5000);
      timeout.unref();
    });
  }

  write(params: { paneId: string; data: string }): void {
    const { paneId, data } = params;
    const session = this.sessions.get(paneId);

    if (!session || !session.isAlive) {
      throw new Error(`Terminal session ${paneId} not found or not alive`);
    }

    session.pty.write(data);
    session.lastActive = Date.now();
  }

  resize(params: { paneId: string; cols: number; rows: number }): void {
    const { paneId, cols, rows } = params;

    // Validate geometry: cols and rows must be positive integers
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
      console.warn(
        `[TerminalManager] Invalid resize geometry for ${paneId}: cols=${cols}, rows=${rows}. Must be positive integers.`
      );
      return;
    }

    const session = this.sessions.get(paneId);

    if (!session || !session.isAlive) {
      console.warn(`Cannot resize terminal ${paneId}: session not found or not alive`);
      return;
    }

    // Same-geometry short-circuit. The renderer's ResizeObserver fires once
    // immediately on attach, so every tab activation / first mount triggers
    // a resize call even when nothing actually changed. Skipping the SIGWINCH
    // here avoids the TUI repaint burst that the activity sampler would
    // otherwise mis-classify as `running`.
    if (session.cols === cols && session.rows === rows) {
      return;
    }

    try {
      // Arm the post-resize suppression window BEFORE pty.resize so the
      // resulting onData burst is gated by the time the sampler ticks.
      if (session.idleDetection) {
        session.suppressActivityUntil = Date.now() + IDLE_TUNING.resizeSuppressMs;
      }
      session.pty.resize(cols, rows);
      session.cols = cols;
      session.rows = rows;
      session.lastActive = Date.now();
      if (session.headlessTerminal) {
        try {
          session.headlessTerminal.resize(cols, rows);
        } catch (err) {
          console.warn(`[TerminalManager] headlessTerminal.resize failed for ${paneId}:`, err);
        }
      }
    } catch (error) {
      console.error(`[TerminalManager] Failed to resize terminal ${paneId} (cols=${cols}, rows=${rows}):`, error);
    }
  }

  signal(params: { paneId: string; signal?: string }): void {
    const { paneId, signal = 'SIGTERM' } = params;
    const session = this.sessions.get(paneId);

    if (!session || !session.isAlive) {
      console.warn(`Cannot signal terminal ${paneId}: session not found or not alive`);
      return;
    }

    // Fire-and-forget: callers (tRPC) don't await; pidtree resolves quickly.
    void killProcessTree(session, signal as KillSignal);
    session.lastActive = Date.now();
  }

  async kill(params: { paneId: string }): Promise<void> {
    const { paneId } = params;
    const session = this.sessions.get(paneId);

    if (!session) {
      console.warn(`Cannot kill terminal ${paneId}: session not found`);
      return;
    }

    if (!session.isAlive) {
      this.sessions.delete(paneId);
      return;
    }

    // Mark this as a deliberate kill so the exit handler doesn't try to
    // "recover" with a fallback shell when the user just clicked Stop.
    session.intentionalKill = true;

    // SIGKILL the whole tree: the user pressed Stop and expects an immediate
    // teardown. SIGTERM lets dev servers (vite, etc.) do graceful shutdown
    // which can take seconds; SIGKILL terminates them instantly.
    await killProcessTree(session, 'SIGKILL');

    // Mark dead and evict synchronously so a quick Run-again creates a fresh
    // session via createOrAttach instead of attaching to the still-dying one.
    session.isAlive = false;
    this.teardownActivityTracking(session);
    if (this.sessions.get(paneId) === session) {
      this.sessions.delete(paneId);
    }
  }

  detach(params: { paneId: string; serializedState?: string }): void {
    const { paneId, serializedState } = params;
    const session = this.sessions.get(paneId);

    if (!session) {
      console.warn(`Cannot detach terminal ${paneId}: session not found`);
      return;
    }

    if (serializedState) {
      session.serializedState = serializedState;
    }
    session.lastActive = Date.now();
  }

  clearScrollback(params: { paneId: string }): void {
    const { paneId } = params;
    const session = this.sessions.get(paneId);

    if (!session) {
      console.warn(`Cannot clear scrollback for terminal ${paneId}: session not found`);
      return;
    }

    session.serializedState = '';
    session.lastActive = Date.now();
  }

  getSession(paneId: string): { isAlive: boolean; cwd: string; lastActive: number } | null {
    const session = this.sessions.get(paneId);
    if (!session) {
      return null;
    }

    return {
      isAlive: session.isAlive,
      cwd: session.cwd,
      lastActive: session.lastActive
    };
  }

  async killByWorkspaceId(workspaceId: string): Promise<{ killed: number; failed: number }> {
    const sessionsToKill = Array.from(this.sessions.entries()).filter(
      ([, session]) => session.workspaceId === workspaceId
    );

    if (sessionsToKill.length === 0) {
      return { killed: 0, failed: 0 };
    }

    const results = await Promise.all(
      sessionsToKill.map(([paneId, session]) => this.killSessionWithTimeout(paneId, session))
    );

    const killed = results.filter(Boolean).length;
    return { killed, failed: results.length - killed };
  }

  private async killSessionWithTimeout(paneId: string, session: TerminalSession): Promise<boolean> {
    if (!session.isAlive) {
      this.sessions.delete(paneId);
      return true;
    }

    // Suppress fallback-shell crash recovery for this teardown.
    session.intentionalKill = true;

    return new Promise<boolean>((resolve) => {
      let resolved = false;
      let sigtermTimeout: ReturnType<typeof setTimeout> | undefined;
      let sigkillTimeout: ReturnType<typeof setTimeout> | undefined;

      const cleanup = (success: boolean) => {
        if (resolved) return;
        resolved = true;
        this.off(`exit:${paneId}`, exitHandler);
        if (sigtermTimeout) clearTimeout(sigtermTimeout);
        if (sigkillTimeout) clearTimeout(sigkillTimeout);
        resolve(success);
      };

      const exitHandler = () => cleanup(true);
      this.once(`exit:${paneId}`, exitHandler);

      // Escalate to SIGKILL after 2s
      sigtermTimeout = setTimeout(() => {
        if (resolved || !session.isAlive) return;

        void killProcessTree(session, 'SIGKILL');

        // Force cleanup after another 500ms
        sigkillTimeout = setTimeout(() => {
          if (resolved) return;
          if (session.isAlive) {
            console.error(`Terminal ${paneId} did not exit after SIGKILL, forcing cleanup`);
            session.isAlive = false;
            this.sessions.delete(paneId);
          }
          cleanup(false);
        }, 500);
        sigkillTimeout.unref();
      }, 2000);
      sigtermTimeout.unref();

      // Send SIGTERM to the whole tree
      killProcessTree(session, 'SIGTERM').catch((error) => {
        console.error(`Failed to send SIGTERM to terminal ${paneId}:`, error);
        session.isAlive = false;
        this.sessions.delete(paneId);
        cleanup(false);
      });
    });
  }

  getSessionCountByWorkspaceId(workspaceId: string): number {
    return Array.from(this.sessions.values()).filter(
      (session) => session.workspaceId === workspaceId && session.isAlive
    ).length;
  }

  /**
   * Get all alive sessions for a given scope key.
   * Used by new workspaces to discover shared terminals.
   */
  getSessionsByScopeKey(scopeKey: string): Array<{ paneId: string; cwd: string; lastActive: number }> {
    return Array.from(this.sessions.values())
      .filter((session) => session.scopeKey === scopeKey && session.isAlive)
      .map((session) => ({
        paneId: session.paneId,
        cwd: session.cwd,
        lastActive: session.lastActive
      }));
  }

  /**
   * Send a newline to all terminals in a workspace to refresh their prompts.
   * Useful after switching branches to update the branch name in prompts.
   */
  refreshPromptsForWorkspace(workspaceId: string): void {
    for (const [paneId, session] of this.sessions.entries()) {
      if (session.workspaceId === workspaceId && session.isAlive) {
        try {
          session.pty.write('\n');
        } catch (error) {
          console.warn(`[TerminalManager] Failed to refresh prompt for pane ${paneId}:`, error);
        }
      }
    }
  }

  detachAllListeners(): void {
    for (const event of this.eventNames()) {
      const name = String(event);
      if (name.startsWith('data:') || name.startsWith('exit:') || name.startsWith('state:')) {
        this.removeAllListeners(event);
      }
    }
  }

  async cleanup(): Promise<void> {
    const exitPromises: Promise<void>[] = [];

    for (const [paneId, session] of this.sessions.entries()) {
      if (session.isAlive) {
        const exitPromise = new Promise<void>((resolve) => {
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          const exitHandler = () => {
            this.off(`exit:${paneId}`, exitHandler);
            if (timeoutId !== undefined) {
              clearTimeout(timeoutId);
            }
            resolve();
          };
          this.once(`exit:${paneId}`, exitHandler);

          timeoutId = setTimeout(() => {
            this.off(`exit:${paneId}`, exitHandler);
            resolve();
          }, 2000);
          timeoutId.unref();
        });

        exitPromises.push(exitPromise);
        // Suppress fallback-shell recovery during shutdown.
        session.intentionalKill = true;
        this.teardownActivityTracking(session);
        // Kill the whole tree; on app shutdown SIGKILL is the right hammer
        // because we can't afford to wait 2s per terminal for SIGTERM.
        void killProcessTree(session, 'SIGKILL');
      }
    }

    await Promise.all(exitPromises);
    this.sessions.clear();
    this.removeAllListeners();
  }
}

/** Singleton terminal manager instance */
export const terminalManager = new TerminalManager();
