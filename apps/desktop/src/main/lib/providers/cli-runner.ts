import { execFile } from 'node:child_process';
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
 * Runs a CLI command safely using execFile (argv array — no shell injection).
 * Inherits the user's shell PATH via getShellEnvironment() on macOS/Linux.
 * Returns stdout/stderr/code; never throws for non-zero exit codes.
 */
export async function runCli(
  cmd: string,
  args: string[],
  options?: { timeoutMs?: number; cwd?: string }
): Promise<CliRunResult> {
  const env = await getShellEnvironment();
  const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      env,
      cwd: options?.cwd,
      timeout,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024
    });
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
