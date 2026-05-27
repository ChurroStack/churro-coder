import type * as pty from 'node-pty';
import type { Terminal as HeadlessTerminal } from '@xterm/headless';

export type TerminalOutputState = 'idle' | 'running';

export interface TerminalSession {
  pty: pty.IPty;
  paneId: string;
  workspaceId: string;
  /** Terminal scope key: "path:<dir>" for shared (local mode) or "ws:<chatId>" for isolated (worktree mode) */
  scopeKey: string;
  cwd: string;
  cols: number;
  rows: number;
  lastActive: number;
  serializedState?: string;
  isAlive: boolean;
  shell: string;
  startTime: number;
  usedFallback: boolean;
  /**
   * Set when the user (or app shutdown) explicitly kills this session, so the
   * exit handler can skip the "crashed-quickly → recover with fallback shell"
   * path. Without this a fast Stop click after spawning could resurrect a
   * fresh fallback shell at the same paneId, swallowing the next Run.
   */
  intentionalKill?: boolean;
  /**
   * Idle detection config presence flag. When set, the manager runs a
   * cursor-activity sampler against {@link headlessTerminal} and emits
   * `state:` events on idle↔running transitions.
   */
  idleDetection?: TerminalBootstrap['idleDetection'];
  /**
   * Current observed CLI output state. Mutated only by the manager's
   * transitionTo() — also the only place that emits the `state:` event.
   */
  outputState?: TerminalOutputState;
  /** Mirror parser used to count cursor moves per sampling window. */
  headlessTerminal?: HeadlessTerminal;
  /** Sampler that evaluates cursor-move rate every IDLE_TUNING.windowMs. */
  idleSamplerInterval?: ReturnType<typeof setInterval>;
  /** Cursor-move count accumulator for the current sampling window. */
  pendingMoves?: number;
  /** Raw PTY byte count accumulator for the current sampling window. */
  pendingBytes?: number;
  /**
   * Ring of the last N windows' "active" flags (1 if the window saw any
   * cursor moves OR any PTY bytes; 0 otherwise). Newest pushed at tail.
   */
  recentMoves?: number[];
}

export interface TerminalDataEvent {
  type: 'data';
  data: string;
}

export interface TerminalExitEvent {
  type: 'exit';
  exitCode: number;
  signal?: number;
}

export type TerminalEvent = TerminalDataEvent | TerminalExitEvent;

/**
 * Multiplexed event for `cli:*` panes. Emitted by the terminal manager on
 * every running↔idle transition AND on PTY exit, alongside the per-pane
 * `state:${paneId}` event. Lets a single renderer-side subscriber mirror
 * every CLI sub-chat's busy state without binding to a specific pane id.
 *
 * `state` is the idle-detection state (`'running' | 'idle'`) for transitions
 * and the sentinel `'exited'` when the PTY ends — subscribers should remove
 * the entry from their map on `'exited'` rather than treating it as idle.
 */
export interface CliStateEvent {
  subChatId: string;
  parentChatId: string | null;
  state: TerminalOutputState | 'exited';
}

export interface SessionResult {
  isNew: boolean;
  /** Serialized terminal state from xterm's SerializeAddon */
  serializedState: string;
}

export interface TerminalBootstrap {
  /** Working directory override (takes precedence over top-level cwd). */
  cwd?: string;
  /** Executable to spawn instead of the default user shell. */
  command?: string;
  /** Arguments for `command`. Ignored when `command` is absent. */
  args?: string[];
  /** Additional env vars merged on top of the standard terminal env. */
  env?: Record<string, string>;
  /**
   * Text written to the PTY once after the first stdout chunk arrives
   * (or after a 250ms ceiling, whichever comes first).
   * A trailing newline is appended automatically.
   */
  initialInput?: string;
  /**
   * Sequence of raw PTY writes issued after the first stdout arrives.
   * Each element is written with a small delay between it and the next so
   * the TUI processes each chunk (and any resulting mode-switch) before the
   * next arrives. Takes precedence over `initialInput` when both are set.
   */
  initialInputChunks?: string[];
  /**
   * Signal from the CLI-harness bootstrap that the first PTY chunk already
   * contains the MCP reminder text. The renderer reads this to seed its
   * per-session "already injected" set so it doesn't re-inject on the user's
   * next typed message.
   */
  mcpReminderInjected?: boolean;
  /**
   * Presence of this object opts the session into cursor-activity-based idle
   * detection (runs an @xterm/headless mirror, emits `state:` transitions).
   * `silenceMs` is only consulted by the initial-input-chunks startup gate in
   * session.ts — steady-state detection uses fixed tuning constants in
   * manager.ts.
   */
  idleDetection?: {
    /** Startup gate only: ms of PTY silence before initial input is written. */
    silenceMs?: number;
  };
}

export interface CreateSessionParams {
  paneId: string;
  tabId?: string;
  workspaceId?: string;
  /** Terminal scope key: "path:<dir>" for shared (local mode) or "ws:<chatId>" for isolated (worktree mode) */
  scopeKey?: string;
  workspaceName?: string;
  workspacePath?: string;
  rootPath?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  initialCommands?: string[];
  /** Optional bootstrap config for CLI-harness and custom-command sessions. */
  bootstrap?: TerminalBootstrap;
}

export interface InternalCreateSessionParams extends CreateSessionParams {
  useFallbackShell?: boolean;
}

export interface DetectedPort {
  port: number;
  pid: number;
  processName: string;
  paneId: string;
  workspaceId: string;
  detectedAt: number;
  address: string;
}
