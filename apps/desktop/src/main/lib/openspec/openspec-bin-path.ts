import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export class OpenspecBundleMissingError extends Error {
  constructor(binDir: string) {
    const isDev = !app.isPackaged;
    const hint = isDev
      ? "Run 'bun run openspec:install' from apps/desktop to install the bundled CLI."
      : 'The openspec bundle is missing from the app package. Please reinstall the app.';
    super(`OpenSpec CLI not found at ${binDir}. ${hint}`);
    this.name = 'OpenspecBundleMissingError';
  }
}

let cachedBinDir: string | null = null;

/**
 * Returns the directory containing the openspec shim scripts.
 * Dev: apps/desktop/resources/openspec/bin/
 * Packaged: {resourcesPath}/openspec/bin/
 */
export function getOpenspecBinDir(): string {
  if (cachedBinDir !== null) return cachedBinDir;

  const isDev = !app.isPackaged;
  const dir = isDev
    ? path.join(app.getAppPath(), 'resources', 'openspec', 'bin')
    : path.join(process.resourcesPath, 'openspec', 'bin');

  if (!fs.existsSync(dir)) {
    console.warn(`[openspec-bin] Shim directory not found: ${dir}`);
    console.warn("[openspec-bin] Run 'bun run openspec:install' to install the bundled CLI");
  } else {
    console.log(`[openspec-bin] Resolved shim directory: ${dir}`);
  }

  cachedBinDir = dir;
  return dir;
}

/**
 * Throws OpenspecBundleMissingError when the shim directory or binary is absent.
 * Call at the top of any procedure that invokes the CLI so the UI gets a typed error.
 */
export function assertOpenspecBinAvailable(): void {
  const binDir = getOpenspecBinDir();
  const bin = path.join(binDir, 'openspec');
  if (!fs.existsSync(bin)) {
    throw new OpenspecBundleMissingError(binDir);
  }
}

/**
 * Env var overrides to inject when spawning agent CLIs so the openspec shim works.
 * - CSCODE_ELECTRON_PATH: path the shim execs with ELECTRON_RUN_AS_NODE=1
 * - OPENSPEC_BIN: absolute path to the shim for agents whose bash tool doesn't
 *   inherit the injected PATH (e.g. Codex sandbox environments)
 * - OPENSPEC_TELEMETRY: disabled to prevent PostHog traffic from inside the app
 */
export function buildOpenspecEnvOverrides(): Record<string, string> {
  const binDir = getOpenspecBinDir();
  return {
    CSCODE_ELECTRON_PATH: process.execPath,
    OPENSPEC_BIN: path.join(binDir, 'openspec'),
    OPENSPEC_TELEMETRY: '0',
    DO_NOT_TRACK: '1',
    CI: 'true'
  };
}
