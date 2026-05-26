import { type ExecFileOptionsWithStringEncoding, execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Cache the shell environment to avoid repeated shell spawns
let cachedEnv: Record<string, string> | null = null;
let cacheTime = 0;
let isFallbackCache = false;
const CACHE_TTL_MS = 60_000; // 1 minute cache
const FALLBACK_CACHE_TTL_MS = 10_000; // 10 second cache for fallback (retry sooner)

// Track PATH fix state for macOS GUI app PATH fix
let pathFixAttempted = false;
let pathFixSucceeded = false;

/**
 * Read the live Windows PATH from the registry (Machine + User scopes). This is
 * the only way to see PATH changes made AFTER this process started — `process.env.PATH`
 * is a snapshot from launch, so a freshly installed `gh` (or any CLI installed via
 * winget/MSI while the app is running) will not appear there until restart.
 *
 * Returns "" on any failure; caller is expected to fall back to process.env.PATH.
 */
async function readWindowsRegistryPath(): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "[Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User')"
      ],
      { timeout: 5_000, windowsHide: true }
    );
    return stdout.trim();
  } catch (err) {
    console.warn('[shell-env] Failed to read Windows registry PATH:', err);
    return '';
  }
}

/**
 * Build Windows PATH by merging the live registry PATH (Machine + User) with
 * process.env.PATH and a small set of well-known CLI install locations.
 *
 * Why the registry: an installer that runs while the app is up updates the
 * registry PATH, but already-running processes never see it. Without this read,
 * the user has to restart the dev server / app every time they install a new
 * CLI dependency (gh, az, etc.) — confusing and easy to misdiagnose as "the
 * detection is broken".
 */
async function buildWindowsPath(): Promise<string> {
  const paths: string[] = [];
  const pathSeparator = ';';

  // Live registry PATH first — picks up post-launch installs.
  const registryPath = await readWindowsRegistryPath();
  if (registryPath) {
    paths.push(...registryPath.split(pathSeparator).filter(Boolean));
  }

  // Merge process.env.PATH on top — covers entries that only exist in the
  // parent shell (e.g. git-bash PATH additions, ad-hoc `set PATH=...`).
  if (process.env.PATH) {
    for (const p of process.env.PATH.split(pathSeparator).filter(Boolean)) {
      const lower = path.normalize(p).toLowerCase();
      if (!paths.some((existing) => path.normalize(existing).toLowerCase() === lower)) {
        paths.push(p);
      }
    }
  }

  // Defensive fallbacks for tools whose installers don't always register on PATH.
  const commonPaths = [
    path.join(os.homedir(), '.local', 'bin'),
    // Git for Windows
    'C:\\Program Files\\Git\\cmd',
    'C:\\Program Files\\Git\\bin',
    // GitHub CLI — default MSI install location
    'C:\\Program Files\\GitHub CLI',
    'C:\\Program Files (x86)\\GitHub CLI',
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'GitHub CLI'),
    // Azure CLI — default MSI install location
    'C:\\Program Files (x86)\\Microsoft SDKs\\Azure\\CLI2\\wbin',
    'C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin',
    // winget shim directory (most modern user-scope installs land here)
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links'),
    // System paths
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
    path.join(process.env.SystemRoot || 'C:\\Windows')
  ];

  for (const commonPath of commonPaths) {
    const normalizedPath = path.normalize(commonPath);
    const normalizedLower = normalizedPath.toLowerCase();
    const alreadyExists = paths.some((p) => path.normalize(p).toLowerCase() === normalizedLower);
    if (!alreadyExists) {
      paths.push(normalizedPath);
    }
  }

  return paths.join(pathSeparator);
}

/**
 * Gets the full shell environment with proper PATH for all platforms.
 *
 * - **Windows**: Derives PATH from process.env + common install locations (no shell spawn)
 * - **macOS/Linux**: Spawns login shell to capture PATH from shell profiles
 *
 * This captures PATH and other environment variables needed to find user-installed tools
 * like git-lfs (homebrew on macOS) or Claude CLI (user-local on Windows).
 *
 * Results are cached for 1 minute to avoid repeated operations.
 */
export async function getShellEnvironment(): Promise<Record<string, string>> {
  const now = Date.now();
  const ttl = isFallbackCache ? FALLBACK_CACHE_TTL_MS : CACHE_TTL_MS;
  if (cachedEnv && now - cacheTime < ttl) {
    // Return a copy to prevent caller mutations from corrupting cache
    return { ...cachedEnv };
  }

  // Windows: derive PATH from (live registry PATH) + process.env.PATH + common
  // install locations. We avoid spawning a full login shell here, but DO spawn
  // PowerShell once per cache TTL to read the registry — this is what lets us
  // pick up CLIs installed after the app launched.
  if (process.platform === 'win32') {
    console.log('[shell-env] Windows detected, deriving PATH from registry + process.env + defaults');
    const winPath = await buildWindowsPath();
    const env: Record<string, string> = {
      ...process.env,
      PATH: winPath,
      HOME: os.homedir(),
      USER: os.userInfo().username,
      USERPROFILE: os.homedir()
    };

    // Ensure all values are strings
    const stringEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string') {
        stringEnv[key] = value;
      }
    }

    cachedEnv = stringEnv;
    cacheTime = now;
    isFallbackCache = false;
    console.log(`[shell-env] Built Windows environment with ${Object.keys(stringEnv).length} vars`);
    return { ...stringEnv };
  }

  // macOS/Linux: spawn login shell to get full environment
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');

  try {
    // Use -lc flags (not -ilc):
    // -l: login shell (sources .zprofile/.profile for PATH setup)
    // -c: execute command
    // Avoids -i (interactive) to skip TTY prompts and reduce latency
    // Also source the interactive rc file so tools like bun that write
    // their PATH export to .zshrc (not .zprofile) are found.
    const home = os.homedir();
    const shellName = path.basename(shell);
    const rcFile = shellName === 'bash' ? '~/.bashrc' : '~/.zshrc';
    const shellCmd = `[ -f ${rcFile} ] && source ${rcFile} 2>/dev/null; env`;
    const { stdout } = await execFileAsync(shell, ['-lc', shellCmd], {
      timeout: 10_000,
      env: {
        ...process.env,
        HOME: home
      }
    });

    const env: Record<string, string> = {};
    for (const line of stdout.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        const key = line.substring(0, idx);
        const value = line.substring(idx + 1);
        env[key] = value;
      }
    }

    // Safety-net for tools that only export to .zshrc/.bashrc. No-ops when
    // the rc-file source above already captured them.
    const safetyPaths = [
      path.join(home, '.bun', 'bin'),
      path.join(home, '.deno', 'bin'),
      path.join(home, '.local', 'bin'),
      path.join(home, '.asdf', 'bin'),
      path.join(home, '.asdf', 'shims'),
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin'
    ];
    const currentPaths = (env.PATH ?? '').split(':').filter(Boolean);
    const currentSet = new Set(currentPaths);
    const extra = safetyPaths.filter((p) => !currentSet.has(p));
    if (extra.length > 0) {
      env.PATH = [...extra, ...currentPaths].join(':');
    }

    cachedEnv = env;
    cacheTime = now;
    isFallbackCache = false;
    return { ...env };
  } catch (error) {
    console.warn(`[shell-env] Failed to get shell environment: ${error}. Falling back to process.env`);
    // Fall back to process.env if shell spawn fails
    // Cache with shorter TTL so we retry sooner
    const fallback: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') {
        fallback[key] = value;
      }
    }
    cachedEnv = fallback;
    cacheTime = now;
    isFallbackCache = true;
    return { ...fallback };
  }
}

/**
 * Checks if git-lfs is available in the given environment.
 */
export async function checkGitLfsAvailable(env: Record<string, string>): Promise<boolean> {
  try {
    await execFileAsync('git', ['lfs', 'version'], {
      timeout: 5_000,
      env
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Clears the cached shell environment.
 * Useful for testing or when environment changes are expected.
 */
export function clearShellEnvCache(): void {
  cachedEnv = null;
  cacheTime = 0;
  isFallbackCache = false;
}

/**
 * Execute a command, retrying once with shell environment if it fails with ENOENT.
 * On macOS, GUI apps launched from Finder/Dock get minimal PATH that excludes
 * homebrew and other user-installed tools. This lazily derives the user's
 * shell environment only when needed, then persists the fix to process.env.PATH.
 */
export async function execWithShellEnv(
  cmd: string,
  args: string[],
  options?: Omit<ExecFileOptionsWithStringEncoding, 'encoding'>
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(cmd, args, { ...options, encoding: 'utf8' });
  } catch (error) {
    // Only retry on ENOENT (command not found), only on macOS
    // Skip if we've already successfully fixed PATH, or if a fix attempt is in progress
    if (
      process.platform !== 'darwin' ||
      pathFixSucceeded ||
      pathFixAttempted ||
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }

    pathFixAttempted = true;
    console.log('[shell-env] Command not found, deriving shell environment');

    try {
      const shellEnv = await getShellEnvironment();

      // Persist the fix to process.env so all subsequent calls benefit
      if (shellEnv.PATH) {
        process.env.PATH = shellEnv.PATH;
        pathFixSucceeded = true;
        console.log('[shell-env] Fixed process.env.PATH for GUI app');
      }

      // Retry with fixed env (respect caller's other env vars, force PATH if present)
      const retryEnv = shellEnv.PATH
        ? { ...shellEnv, ...options?.env, PATH: shellEnv.PATH }
        : { ...shellEnv, ...options?.env };

      return await execFileAsync(cmd, args, {
        ...options,
        encoding: 'utf8',
        env: retryEnv
      });
    } catch (retryError) {
      // Shell env derivation or retry failed - allow future retries
      pathFixAttempted = false;
      console.error('[shell-env] Retry failed:', retryError);
      throw retryError;
    }
  }
}
