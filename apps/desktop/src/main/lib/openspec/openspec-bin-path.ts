import { detectCliTool } from '../cli-harness/detect';

export class OpenspecCliMissingError extends Error {
  constructor() {
    super('OpenSpec CLI not found on PATH. Install it with: npm install -g @fission-ai/openspec');
    this.name = 'OpenspecCliMissingError';
  }
}

/**
 * Resolve the absolute path of the user's PATH-installed `openspec`, or null if
 * it is not installed. Detection goes through the shell-env-aware `detectCliTool`
 * so a Finder-launched macOS app still finds Homebrew / npm-global installs.
 */
export async function resolveOpenspecBin(): Promise<string | null> {
  const d = await detectCliTool('openspec');
  return d.available ? (d.path ?? 'openspec') : null;
}

/**
 * Throws OpenspecCliMissingError when `openspec` is not installed on PATH.
 * Call (with await) at the top of any procedure that invokes the CLI so the UI
 * gets a typed error.
 */
export async function assertOpenspecBinAvailable(): Promise<void> {
  const bin = await resolveOpenspecBin();
  if (!bin) throw new OpenspecCliMissingError();
}

/**
 * Env overrides injected when spawning agent CLIs or invoking openspec directly:
 * disable telemetry. The CLI itself is now resolved from the user's PATH, so we
 * no longer inject the Electron-as-Node shim vars (CSCODE_ELECTRON_PATH /
 * OPENSPEC_BIN) — the global `openspec` brings its own Node.
 */
export function buildOpenspecEnvOverrides(): Record<string, string> {
  return {
    OPENSPEC_TELEMETRY: '0',
    DO_NOT_TRACK: '1',
    CI: 'true'
  };
}
