import type * as pty from 'node-pty';

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
  /** Active idle-detection timer (reset on every PTY data chunk). */
  idleTimer?: ReturnType<typeof setTimeout>;
  /** Idle detection config, stored for reset-on-data logic in manager. */
  idleDetection?: TerminalBootstrap['idleDetection'];
  /** True while the PTY is actively producing output (cleared when idle fires). */
  isActiveOutput?: boolean;
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
  /** Optional idle-detection config. */
  idleDetection?: {
    /** How long (ms) of PTY silence before emitting an `idle` event. Default 30 000. */
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
