import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getShellEnvironment } from '../git/shell-env';
import { buildOpenspecEnvOverrides, resolveOpenspecBin, OpenspecCliMissingError } from './openspec-bin-path';

const execFileAsync = promisify(execFile);

export class OpenspecCliError extends Error {
  constructor(
    message: string,
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly code: number | null
  ) {
    super(message);
    this.name = 'OpenspecCliError';
  }
}

/**
 * Runs the user's PATH-installed openspec CLI with the given args in the given
 * working directory. Resolves the absolute binary via the shell-env-aware
 * detector and spawns it with the login-shell PATH (so a Finder-launched macOS
 * app finds it) plus the telemetry-off overrides. Throws OpenspecCliMissingError
 * when openspec is not installed, OpenspecCliError on a non-zero exit.
 */
export async function runOpenspecCli(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  const bin = await resolveOpenspecBin();
  if (!bin) throw new OpenspecCliMissingError();

  const env = { ...(await getShellEnvironment()), ...buildOpenspecEnvOverrides() };

  console.log(`[openspec-cli] running: ${bin} ${args.join(' ')} cwd=${cwd}`);

  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd,
      env,
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024
    });
    return { stdout: stdout ?? '', stderr: stderr ?? '' };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    const stdout = e.stdout ?? '';
    const stderr = e.stderr ?? '';
    const code = typeof e.code === 'number' ? e.code : null;
    const hint = stderr.trim() || stdout.trim() || e.message;
    console.error(`[openspec-cli] error code=${code} stderr=${stderr.slice(0, 500)}`);
    throw new OpenspecCliError(`openspec ${args[0] ?? ''} failed (exit ${code}): ${hint}`, stdout, stderr, code);
  }
}
