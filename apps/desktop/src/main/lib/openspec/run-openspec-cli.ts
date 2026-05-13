import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { getOpenspecBinDir, buildOpenspecEnvOverrides } from './openspec-bin-path';

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
 * Runs the bundled openspec CLI with the given args in the given working directory.
 * Merges buildOpenspecEnvOverrides() into the child environment so the shim works.
 * Throws OpenspecCliError on non-zero exit.
 */
export async function runOpenspecCli(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  const binDir = getOpenspecBinDir();
  const bin = path.join(binDir, 'openspec');

  const env = { ...process.env, ...buildOpenspecEnvOverrides() };

  console.log(`[openspec-cli] running: openspec ${args.join(' ')} cwd=${cwd}`);

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
