import { app } from 'electron';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { stripVTControlCharacters } from 'node:util';
import { getDefaultShell, isWindows, platform } from '../platform';
import { buildOpenspecEnvOverrides } from '../openspec/openspec-bin-path';

// Cache the shell environment
let cachedShellEnv: Record<string, string> | null = null;

// Delimiter for parsing env output
const DELIMITER = '_CLAUDE_ENV_DELIMITER_';

// Keys to strip (prevent interference from unrelated providers)
// NOTE: We intentionally keep ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL in production
// so users can use their existing Claude Code CLI configuration (API proxy, etc.)
// Based on PR #29 by @sa4hnd
const STRIPPED_ENV_KEYS_BASE = [
  'OPENAI_API_KEY',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  // Prevent "Claude Code cannot be launched inside another session" when the
  // dev build is spawned from a `claude` CLI terminal — the CLI sets these
  // markers on its environment and they propagate into Electron's process.env.
  // We unconditionally strip them here and then re-set CLAUDE_CODE_ENTRYPOINT
  // to our own value below (order matters: strip → set).
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDECODE'
];

// In dev mode, also strip ANTHROPIC_API_KEY so OAuth token is used instead
// This allows devs to test OAuth flow without unsetting their shell env
// Added by Sergey Bunas for dev purposes
const STRIPPED_ENV_KEYS = !app.isPackaged ? [...STRIPPED_ENV_KEYS_BASE, 'ANTHROPIC_API_KEY'] : STRIPPED_ENV_KEYS_BASE;

/**
 * Parse environment variables from shell output
 */
function parseEnvOutput(output: string): Record<string, string> {
  const envSection = output.split(DELIMITER)[1];
  if (!envSection) return {};

  const env: Record<string, string> = {};
  for (const line of stripVTControlCharacters(envSection).split('\n').filter(Boolean)) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex > 0) {
      const key = line.substring(0, separatorIndex);
      const value = line.substring(separatorIndex + 1);
      env[key] = value;
    }
  }
  return env;
}

/**
 * Strip sensitive keys from environment
 */
function stripSensitiveKeys(env: Record<string, string>): void {
  for (const key of STRIPPED_ENV_KEYS) {
    if (key in env) {
      console.log(`[claude-env] Stripped ${key} from shell environment`);
      delete env[key];
    }
  }
}

/**
 * Load full shell environment.
 * - Windows: Derives PATH from process.env + common install locations (no shell spawn)
 * - macOS/Linux: Spawns interactive login shell to capture PATH from shell profiles
 * Results are cached for the lifetime of the process.
 */
export function getClaudeShellEnvironment(): Record<string, string> {
  if (cachedShellEnv !== null) {
    return { ...cachedShellEnv };
  }

  // Windows: use platform provider to build environment
  if (isWindows()) {
    console.log('[claude-env] Windows detected, deriving PATH without shell invocation');

    // Use platform provider to build environment
    const env = platform.buildEnvironment();

    // Strip sensitive keys
    stripSensitiveKeys(env);

    console.log(`[claude-env] Built Windows environment with ${Object.keys(env).length} vars`);
    cachedShellEnv = env;
    return { ...env };
  }

  // macOS/Linux: spawn interactive login shell to get full environment
  const shell = getDefaultShell();
  const command = `echo -n "${DELIMITER}"; env; echo -n "${DELIMITER}"; exit`;

  try {
    // Use execFileSync with argv array — no shell-string interpolation, so a
    // compromised `shell` path can't smuggle additional commands via the outer
    // template literal.
    const output = execFileSync(shell, ['-ilc', command], {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        // Prevent Oh My Zsh from blocking with auto-update prompts
        DISABLE_AUTO_UPDATE: 'true',
        // Minimal env to bootstrap the shell
        HOME: os.homedir(),
        USER: os.userInfo().username,
        SHELL: shell
      }
    });

    const env = parseEnvOutput(output);
    stripSensitiveKeys(env);

    console.log(`[claude-env] Loaded ${Object.keys(env).length} environment variables from shell`);
    cachedShellEnv = env;
    return { ...env };
  } catch (error) {
    console.error('[claude-env] Failed to load shell environment:', error);

    // Fallback: use platform provider
    const env = platform.buildEnvironment();
    stripSensitiveKeys(env);

    console.log('[claude-env] Using fallback environment from platform provider');
    cachedShellEnv = env;
    return { ...env };
  }
}

/**
 * Build the complete environment for Claude SDK.
 * Merges shell environment, process.env, and custom overrides.
 */
export function buildClaudeEnv(options?: {
  ghToken?: string;
  customEnv?: Record<string, string>;
  enableTasks?: boolean;
}): Record<string, string> {
  const env: Record<string, string> = {};

  // 1. Start with shell environment (has HOME, full PATH, etc.)
  try {
    Object.assign(env, getClaudeShellEnvironment());
  } catch (error) {
    console.error('[claude-env] Shell env failed, using process.env');
  }

  // 2. Overlay current process.env (preserves Electron-set vars)
  // BUT: Don't overwrite PATH from shell env - Electron's PATH is minimal when launched from Finder
  const shellPath = env.PATH;
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  // Restore shell PATH if we had one (it contains nvm, homebrew, etc.)
  if (shellPath) {
    env.PATH = shellPath;
  }

  // 2b. Strip sensitive keys again (process.env may have re-added them)
  // This ensures ANTHROPIC_API_KEY from dev's shell doesn't override OAuth in dev mode
  // Added by Sergey Bunas for dev purposes
  for (const key of STRIPPED_ENV_KEYS) {
    if (key in env) {
      console.log(`[claude-env] Stripped ${key} from final environment`);
      delete env[key];
    }
  }

  // 3. Ensure critical vars are present using platform provider
  const platformEnv = platform.buildEnvironment();
  if (!env.HOME) env.HOME = platformEnv.HOME;
  if (!env.USER) env.USER = platformEnv.USER;
  if (!env.TERM) env.TERM = 'xterm-256color';
  if (!env.SHELL) env.SHELL = getDefaultShell();

  // Windows-specific: ensure USERPROFILE is set
  if (isWindows() && !env.USERPROFILE) {
    env.USERPROFILE = os.homedir();
  }

  // 4. Add custom overrides
  if (options?.ghToken) {
    env.GH_TOKEN = options.ghToken;
  }
  if (options?.customEnv) {
    for (const [key, value] of Object.entries(options.customEnv)) {
      if (value === '') {
        delete env[key];
      } else {
        env[key] = value;
      }
    }
  }

  // 5. Mark as SDK entry
  env.CLAUDE_CODE_ENTRYPOINT = 'sdk-ts';
  // Enable/disable task management tools based on user preference (default: enabled)
  env.CLAUDE_CODE_ENABLE_TASKS = options?.enableTasks !== false ? 'true' : 'false';

  // 6. OpenSpec telemetry-off env. The CLI is resolved from the user's PATH now
  // (no bundled shim to prepend) — the agent's inherited shell PATH already
  // includes the global `openspec` install.
  Object.assign(env, buildOpenspecEnvOverrides());

  return env;
}

/**
 * Clear cached shell environment (useful for testing)
 */
export function clearClaudeEnvCache(): void {
  cachedShellEnv = null;
}

/**
 * Debug: Log key environment variables
 */
export function logClaudeEnv(env: Record<string, string>, prefix: string = ''): void {
  console.log(`${prefix}[claude-env] HOME: ${env.HOME}`);
  console.log(`${prefix}[claude-env] USER: ${env.USER}`);
  console.log(`${prefix}[claude-env] PATH includes homebrew: ${env.PATH?.includes('/opt/homebrew')}`);
  console.log(`${prefix}[claude-env] PATH includes /usr/local/bin: ${env.PATH?.includes('/usr/local/bin')}`);
  console.log(`${prefix}[claude-env] ANTHROPIC_AUTH_TOKEN: ${env.ANTHROPIC_AUTH_TOKEN ? 'set' : 'not set'}`);
}
