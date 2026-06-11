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

export interface TerminalBootstrapConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  initialInput?: string;
  initialInputChunks?: string[];
  /**
   * Set by chats.buildCliBootstrap when the first PTY chunk already contains
   * the MCP reminder text. The chat-cli-surface uses it to seed the dispatcher
   * so the renderer doesn't re-inject the reminder on the user's next message.
   */
  mcpReminderInjected?: boolean;
  idleDetection?: { silenceMs?: number };
}

export interface TerminalProps {
  paneId: string;
  cwd: string;
  workspaceId?: string;
  /** Terminal scope key for shared terminal support */
  scopeKey?: string;
  tabId?: string;
  initialCommands?: string[];
  initialCwd?: string;
  /** Optional bootstrap config for CLI-harness sessions. */
  bootstrap?: TerminalBootstrapConfig;
  /**
   * When set, a keystroke on an exited PTY delegates restart to this callback
   * instead of the Terminal's built-in `restartTerminal()` (which re-attaches
   * without a bootstrap and would respawn a CLI pane as a bare shell). CLI
   * surfaces pass this so the keypress affordance runs the same kill+rebootstrap
   * path as the Restart button. Plain terminals omit it and keep the shell
   * respawn behavior.
   */
  onExitedKeyPress?: () => void;
  /**
   * Erase scrollback when the column count changes. Pass true for Ink-based CLIs
   * (claude-cli) that hard-wrap output to COLUMNS; omit for codex-cli and plain
   * terminals that use terminal-native soft-wrapping xterm can reflow.
   */
  clearScrollbackOnColChange?: boolean;
}

export interface TerminalStreamEvent {
  type: 'data' | 'exit';
  data?: string;
  exitCode?: number;
  signal?: number;
}

/**
 * Represents a terminal instance in the multi-terminal system.
 * Each chat can have multiple terminal instances.
 */
export interface TerminalInstance {
  /** Unique terminal id (nanoid) */
  id: string;
  /** Full paneId for TerminalManager: `${chatId}:term:${id}` */
  paneId: string;
  /** Display name: "Terminal 1", "Terminal 2", etc. */
  name: string;
  /** Creation timestamp */
  createdAt: number;
  /** Optional commands to run on first attach. Persists so the right command runs after a renderer reload. */
  initialCommands?: string[];
}
