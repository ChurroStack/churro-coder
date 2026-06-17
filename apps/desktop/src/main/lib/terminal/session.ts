import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as pty from 'node-pty';
import { Terminal as HeadlessTerminal } from '@xterm/headless';
import { buildTerminalEnv, FALLBACK_SHELL, getDefaultShell } from './env';
import { resolveProjectEnv } from './project-env';
import type { InternalCreateSessionParams, TerminalSession } from './types';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

function getShellArgs(shell: string): string[] {
  if (shell.includes('zsh')) {
    return ['-l'];
  }
  if (shell.includes('bash')) {
    return [];
  }
  return [];
}

/**
 * Validate and resolve cwd path (Windows compatibility)
 * Falls back to home directory if path doesn't exist
 */
function validateAndResolveCwd(cwd: string): string {
  // Expand shell tilde shorthand before filesystem checks — '~' is not a real path.
  const expanded = cwd === '~' ? os.homedir() : cwd.startsWith('~/') ? path.join(os.homedir(), cwd.slice(2)) : cwd;

  if (!fs.existsSync(expanded)) {
    const homeDir = os.homedir();
    console.warn(`[Terminal] CWD does not exist: ${expanded}, using home directory: ${homeDir}`);
    return homeDir;
  }

  try {
    const stat = fs.statSync(expanded);
    if (!stat.isDirectory()) {
      const homeDir = os.homedir();
      console.warn(`[Terminal] CWD is not a directory: ${expanded}, using home directory: ${homeDir}`);
      return homeDir;
    }
  } catch {
    const homeDir = os.homedir();
    console.warn(`[Terminal] Error checking CWD: ${expanded}, using home directory: ${homeDir}`);
    return homeDir;
  }

  try {
    return path.resolve(expanded);
  } catch {
    const homeDir = os.homedir();
    console.warn(`[Terminal] Error resolving CWD: ${expanded}, using home directory: ${homeDir}`);
    return homeDir;
  }
}

/**
 * Resolve shell path for Windows
 * Tries to find shell in common Windows locations
 */
function resolveShellPath(shell: string): string {
  if (os.platform() !== 'win32') return shell;

  // If shell already has a path, use it as-is
  if (shell.includes('\\') || shell.includes('/')) return shell;

  // Try common Windows shell locations
  const commonPaths = [
    process.env.COMSPEC || '',
    process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : '',
    process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\cmd.exe` : ''
  ].filter(Boolean);

  for (const shellPath of commonPaths) {
    if (fs.existsSync(shellPath)) {
      return shellPath;
    }
  }

  // Return as-is, let node-pty handle PATH resolution
  return shell;
}

export async function createSession(
  params: InternalCreateSessionParams,
  onData: (paneId: string, data: string) => void,
  /**
   * Fired exactly once, when the bootstrap injects its first prompt (the
   * `start()` gate below). The manager wires this to markCliTurnStart so a
   * plan-mode bootstrap deterministically opens the "running" spinner the
   * instant the turn is submitted — instead of waiting for the output-activity
   * heuristic to (maybe) detect it 1-2s later. User-typed / dispatcher turns
   * are handled separately by manager.write's Enter-detection.
   */
  onTurnStart?: (paneId: string) => void
): Promise<TerminalSession> {
  const {
    paneId,
    tabId,
    workspaceId,
    workspaceName,
    workspacePath,
    rootPath,
    cwd,
    cols,
    rows,
    useFallbackShell = false,
    bootstrap
  } = params;

  // Bootstrap overrides take precedence over top-level params
  const effectiveCwd = bootstrap?.cwd || cwd;
  const defaultShell = useFallbackShell ? FALLBACK_SHELL : getDefaultShell();
  const shell = bootstrap?.command || defaultShell;
  const shellArgs = bootstrap?.command ? (bootstrap.args ?? []) : getShellArgs(defaultShell);

  if (!effectiveCwd) {
    console.warn(
      `[Terminal] No cwd provided for paneId=${paneId} — falling back to ${os.homedir()}. This usually means the workspace path wasn't ready when the terminal was created.`
    );
  }
  const workingDir = validateAndResolveCwd(effectiveCwd || os.homedir());
  const terminalCols = cols || DEFAULT_COLS;
  const terminalRows = rows || DEFAULT_ROWS;

  // Project-wide user env vars (decrypted). Resolved per spawn so every new
  // session picks up the latest values; failures resolve to {} (never blocks).
  const projectEnv = await resolveProjectEnv(workspaceId, workingDir);
  const baseEnv = buildTerminalEnv({
    shell: defaultShell,
    paneId,
    tabId,
    workspaceId,
    workspaceName,
    workspacePath,
    rootPath,
    projectEnv
  });
  const env = bootstrap?.env ? { ...baseEnv, ...bootstrap.env } : baseEnv;

  const resolvedShell = resolveShellPath(shell);
  let ptyProcess: import('node-pty').IPty;
  try {
    ptyProcess = pty.spawn(resolvedShell, shellArgs, {
      name: 'xterm-256color',
      cols: terminalCols,
      rows: terminalRows,
      cwd: workingDir,
      env
    });
  } catch (error) {
    console.error(`[Terminal] Failed to spawn PTY with ${resolvedShell}:`, error);
    ptyProcess = pty.spawn(FALLBACK_SHELL, [], {
      name: 'xterm-256color',
      cols: terminalCols,
      rows: terminalRows,
      cwd: workingDir,
      env
    });
  }

  // Headless parser used by TerminalManager's cursor-activity sampler. We
  // create one only when the bootstrap opts into idle detection — non-CLI
  // shells don't need to pay the parser cost. scrollback:0 keeps memory
  // minimal; we only read cursor position, never buffer contents.
  const headlessTerminal = bootstrap?.idleDetection
    ? new HeadlessTerminal({ cols: terminalCols, rows: terminalRows, scrollback: 0, allowProposedApi: true })
    : undefined;

  const session: TerminalSession = {
    pty: ptyProcess,
    paneId,
    workspaceId: workspaceId || '',
    scopeKey: params.scopeKey || workspaceId || '',
    cwd: workingDir,
    cols: terminalCols,
    rows: terminalRows,
    lastActive: Date.now(),
    isAlive: true,
    shell,
    startTime: Date.now(),
    usedFallback: useFallbackShell,
    idleDetection: bootstrap?.idleDetection,
    headlessTerminal
  };

  ptyProcess.onData((data) => {
    onData(paneId, data);
  });

  // Write initialInputChunks (preferred) or initialInput once after the first
  // stdout chunk OR after 250ms. Chunks are written sequentially with a 150ms
  // gap so the TUI processes each write (and any mode-switch) before the next.
  const chunks: string[] | null = bootstrap?.initialInputChunks?.length
    ? bootstrap.initialInputChunks
    : bootstrap?.initialInput
      ? [bootstrap.initialInput.replace(/\n/g, '\r').replace(/\r?$/, '\r')]
      : null;

  if (chunks) {
    let started = false;

    const writeSequentially = (remaining: string[]) => {
      if (remaining.length === 0) return;
      const [head, ...rest] = remaining;
      if (session.isAlive) session.pty.write(head);
      if (rest.length > 0) {
        setTimeout(() => writeSequentially(rest), 150);
      }
    };

    const start = () => {
      if (started) return;
      started = true;
      // The idle/ceiling timers that schedule start() are not cancelled when the
      // PTY exits early, so this can fire after the session died (and after a new
      // session may have reused the same paneId). Bail on the captured — now
      // dead — session so we neither write stale chunks nor fire a turn-start
      // that the manager would resolve onto a successor session.
      if (!session.isAlive) return;
      // Deterministic turn-start: the first prompt is being submitted now.
      // Fire before the chunk writes so the spinner opens at submit time, not
      // after the model's output heuristically trips the idle sampler.
      onTurnStart?.(paneId);
      writeSequentially(chunks);
    };

    // Wait for idle (silenceMs of no output) before writing — the CLI TUI
    // input handler isn't ready until it has printed its startup banner and
    // reached its prompt. Fires on the first silence window; the 15s ceiling
    // is a last-resort fallback so chunks are never dropped silently.
    const silenceMs = bootstrap?.idleDetection?.silenceMs ?? 1000;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const ceiling = setTimeout(start, 15_000);
    const dataHandle = ptyProcess.onData(() => {
      if (started) {
        dataHandle.dispose();
        clearTimeout(ceiling);
        return;
      }
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        clearTimeout(ceiling);
        start();
      }, silenceMs);
    });
  }

  return session;
}

/**
 * Set up initial commands to run after shell prompt is ready.
 * Commands are only sent for new sessions (not reattachments).
 */
export function setupInitialCommands(session: TerminalSession, initialCommands: string[] | undefined): void {
  if (!initialCommands || initialCommands.length === 0) {
    return;
  }

  const initialCommandString = `${initialCommands.join(' && ')}\n`;

  const dataHandler = session.pty.onData(() => {
    dataHandler.dispose();

    setTimeout(() => {
      if (session.isAlive) {
        session.pty.write(initialCommandString);
      }
    }, 100);
  });
}
