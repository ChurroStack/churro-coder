/**
 * PATH-based detection + version gating for the agent CLIs (claude / codex /
 * openspec). This is the single resolution path used by BOTH:
 *   - the `newProject.detectCli` tRPC query (UI status), and
 *   - `cli-harness` `resolveBinary` (spawning).
 * Having one cache here closes the historical divergence bug where the UI said
 * "installed" but a spawn still used a stale negative result from a second cache.
 *
 * All lookups go through `runCli`, which sources the login-shell PATH
 * (`getShellEnvironment`) — required because a Finder-launched macOS `.app` has
 * a minimal PATH that excludes Homebrew / npm-global / ~/.local/bin, and because
 * Windows reads PATH afresh from the registry to see post-launch installs.
 */

import { runCli } from '../providers/cli-runner';
import { CLI_MIN_VERSIONS, meetsMinimum, parseSemver, type CliTool } from '../../../shared/cli-install-commands';

export interface CliDetectResult {
  available: boolean;
  /** Extracted `x.y.z` (or the raw first line) when available. */
  version?: string;
  /** Absolute resolved path, used by the harness to spawn. */
  path?: string;
  requiredVersion: string;
  meetsMinimum: boolean;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<CliTool, { value: CliDetectResult; at: number }>();

/** Evict one tool's cached detection (or all). Called on Recheck / Retry. */
export function evictCliDetect(tool?: CliTool): void {
  if (tool) cache.delete(tool);
  else cache.clear();
}

/** Resolve the absolute path of `tool` via `which`/`where` under the shell PATH. */
async function resolveCliPath(tool: CliTool): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const r = await runCli(finder, [tool], { timeoutMs: 5_000 });
  if (r.code !== 0) return null;
  const first = r.stdout.trim().split('\n')[0]?.trim();
  return first || null;
}

function extractVersion(stdout: string): string {
  const triple = stdout.match(/\d+\.\d+\.\d+/)?.[0];
  return triple ?? stdout.trim().split('\n')[0]?.trim() ?? 'unknown';
}

/**
 * Detect whether `tool` is installed on PATH and meets its minimum version.
 * Cached for 60 s; pass `{ evict: true }` (or call `evictCliDetect` first) to
 * force a fresh probe.
 */
export async function detectCliTool(tool: CliTool, opts?: { evict?: boolean }): Promise<CliDetectResult> {
  if (opts?.evict) cache.delete(tool);
  const cached = cache.get(tool);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const requiredVersion = CLI_MIN_VERSIONS[tool];
  const resolvedPath = await resolveCliPath(tool);

  let result: CliDetectResult;
  if (!resolvedPath) {
    result = { available: false, requiredVersion, meetsMinimum: false };
  } else {
    const vr = await runCli(resolvedPath, ['--version'], { timeoutMs: 5_000 });
    const version = vr.code === 0 ? extractVersion(vr.stdout) : 'unknown';
    result = {
      available: true,
      path: resolvedPath,
      version,
      requiredVersion,
      meetsMinimum: meetsMinimum(version, requiredVersion)
    };
  }

  const parsed = result.version ? parseSemver(result.version) : null;
  console.log(
    `[cli-detect] tool=${tool} available=${result.available} version=${result.version ?? 'n/a'}` +
      ` parsed=${parsed ? parsed.join('.') : 'n/a'} meetsMin=${result.meetsMinimum} path=${result.path ?? 'n/a'}`
  );

  cache.set(tool, { value: result, at: Date.now() });
  return result;
}
