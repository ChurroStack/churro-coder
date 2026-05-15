import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as pty from 'node-pty';
import { buildTerminalEnv, FALLBACK_SHELL, getDefaultShell } from './env';
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
  onData: (paneId: string, data: string) => void
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

  const baseEnv = buildTerminalEnv({
    shell: defaultShell,
    paneId,
    tabId,
    workspaceId,
    workspaceName,
    workspacePath,
    rootPath
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
    idleDetection: bootstrap?.idleDetection
  };

  ptyProcess.onData((data) => {
    onData(paneId, data);
  });

  // Write initialInput once after the first stdout chunk OR after 250ms
  if (bootstrap?.initialInput) {
    const input = bootstrap.initialInput.endsWith('\n') ? bootstrap.initialInput : `${bootstrap.initialInput}\n`;
    let written = false;
    const write = () => {
      if (written) return;
      written = true;
      if (session.isAlive) {
        session.pty.write(input);
      }
    };
    const ceiling = setTimeout(write, 250);
    const dataHandle = ptyProcess.onData(() => {
      clearTimeout(ceiling);
      dataHandle.dispose();
      write();
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
