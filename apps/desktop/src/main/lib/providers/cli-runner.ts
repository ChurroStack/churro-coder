import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { getShellEnvironment } from '../git/shell-env';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 5_000;

export interface CliRunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * On Windows, walk PATH honoring PATHEXT to find the full path of `cmd`
 * (so `az` resolves to `…\az.cmd`, `gh` to `…\gh.exe`, etc.). Without this,
 * Node's execFile can't launch CLIs that ship as `.cmd`/`.bat` (Azure CLI is
 * the canonical example — it has no `.exe`, only `az.cmd`).
 *
 * Returns the full resolved path or `null` if not found. Skips on non-Windows.
 */
function resolveWindowsExecutable(cmd: string, env: Record<string, string>): string | null {
  if (process.platform !== 'win32') return null;
  if (path.isAbsolute(cmd)) return existsSync(cmd) ? cmd : null;

  const dirs = (env.PATH ?? '').split(';').filter(Boolean);
  const pathext = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  // If the caller already supplied an extension, only try that exact name.
  // Otherwise try EACH PATHEXT — never the bare name, because Windows cannot
  // execute extensionless files. (Azure CLI's wbin ships `az` (a POSIX bash
  // wrapper), `az.cmd`, and `azps.ps1` — if we matched the bare `az` first
  // we'd resolve to the unrunnable wrapper and fail with ENOENT.)
  const hasExt = path.extname(cmd) !== '';
  const candidates = hasExt ? [cmd] : pathext.map((ext) => cmd + ext.toLowerCase());

  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

/**
 * Quote an argv element for cmd.exe so its parser doesn't interpret special
 * characters (`&`, `|`, `<`, `>`, `^`, `(`, `)`, `"`, spaces). Pairs with
 * `windowsVerbatimArguments: true` — Node won't re-escape on our behalf.
 *
 * Note: `%` is intentionally NOT escaped here. On the cmd command line, the
 * correct way to defuse env-var expansion is caret-escape (`^%FOO^%`), not
 * doubling — `%%` only un-doubles inside batch FILES. None of the args we
 * pass to provider CLIs contain `%` today, so we don't bother.
 */
function quoteCmdArg(arg: string): string {
  if (arg === '') return '""';
  const needsQuotes = /[\s"&|<>^()!]/.test(arg);
  // Double embedded `"` — cmd's escape syntax inside a `"..."` group.
  const escaped = arg.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

/**
 * Runs a CLI command safely. On macOS/Linux uses execFile directly. On
 * Windows resolves the full path via PATHEXT first; `.cmd`/`.bat` scripts go
 * through `cmd.exe /d /s /c` because the OS can't exec them directly.
 * Returns stdout/stderr/code; never throws for non-zero exit codes.
 */
export async function runCli(
  cmd: string,
  args: string[],
  options?: { timeoutMs?: number; cwd?: string }
): Promise<CliRunResult> {
  const env = await getShellEnvironment();
  const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Windows: resolve to a real file (gh.exe / az.cmd / etc.) so we know
  // whether we can exec directly or have to route through cmd.exe.
  const resolved = resolveWindowsExecutable(cmd, env);
  const isBatchScript = resolved !== null && /\.(cmd|bat)$/i.test(resolved);

  try {
    let stdout: string;
    let stderr: string;
    if (isBatchScript && resolved) {
      // Standard cmd.exe idiom for paths with spaces: `cmd /d /s /c "<inner>"`.
      // /s strips THE OUTER pair of quotes (and only that pair), leaving the
      // inner `"path with spaces\az.cmd" arg1 arg2 …` intact for cmd's normal
      // parser. Without the outer wrap, cmd's "exactly two quotes, no special
      // chars between them" rule strips the path's quotes and tokenizes on
      // the first space → "'C:\Program' is not recognized as a command".
      const inner = [quoteCmdArg(resolved), ...args.map(quoteCmdArg)].join(' ');
      const comspec = env.ComSpec || env.comspec || 'cmd.exe';
      const result = await execFileAsync(comspec, ['/d', '/s', '/c', `"${inner}"`], {
        env,
        cwd: options?.cwd,
        timeout,
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
        windowsVerbatimArguments: true
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } else {
      const target = resolved ?? cmd;
      const result = await execFileAsync(target, args, {
        env,
        cwd: options?.cwd,
        timeout,
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024
      });
      stdout = result.stdout;
      stderr = result.stderr;
    }
    return { stdout: stdout ?? '', stderr: stderr ?? '', code: 0 };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    // ENOENT = binary not on PATH
    if (e.code === 'ENOENT') {
      return { stdout: '', stderr: `Command not found: ${cmd}`, code: 127 };
    }
    // Timeout
    if (e.code === 'ETIMEDOUT' || (e as { killed?: boolean }).killed) {
      return { stdout: '', stderr: `Command timed out after ${timeout}ms`, code: 124 };
    }
    // Non-zero exit (execFile throws when exit code != 0)
    const code = typeof e.code === 'number' ? e.code : 1;
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      code
    };
  }
}
