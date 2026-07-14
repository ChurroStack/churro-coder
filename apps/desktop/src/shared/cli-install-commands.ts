/**
 * Single source of truth for the agent-CLI tools the app detects on the user's
 * PATH (claude / codex / openspec), their minimum supported versions, and the
 * platform-specific install/upgrade commands shown in the UI.
 *
 * Shared by BOTH the renderer (the `CliInstallInstructions` component) and the
 * main process (the `cli-harness` `binary-missing` hint) so the commands and the
 * version floors can never drift between the two.
 *
 * Pure module — no Electron / Node APIs. Callers pass the platform explicitly
 * (renderer: `getPlatform()`; main: `process.platform`).
 */

export type CliTool = 'claude' | 'codex' | 'openspec';
export type CliPlatform = 'darwin' | 'win32' | 'linux' | 'unknown';

/** Human-facing labels for the three tools. */
export const CLI_LABELS: Record<CliTool, string> = {
  claude: 'Claude Code CLI',
  codex: 'Codex CLI',
  openspec: 'OpenSpec CLI'
};

/**
 * Minimum versions the app is tested against. Bumped when new models require a
 * newer binary (e.g. codex 0.144.0 for GPT-5.6 family). The gate is advisory —
 * an older CLI still runs, the UI just nudges an upgrade.
 */
export const CLI_MIN_VERSIONS: Record<CliTool, string> = {
  claude: '2.1.156',
  codex: '0.144.0',
  openspec: '1.3.1'
};

/**
 * Platform-specific install commands (also used as the upgrade command — every
 * installer below pulls latest). Each string is one line; a leading `#` marks a
 * fallback hint, mirroring the existing provider install-steps convention.
 * `unknown` falls back to the macOS commands.
 */
export function getCliInstallCommands(tool: CliTool, platform: CliPlatform): string[] {
  if (tool === 'claude') {
    if (platform === 'win32') {
      return ['irm https://claude.ai/install.ps1 | iex', '# or: npm install -g @anthropic-ai/claude-code'];
    }
    // darwin / linux / unknown
    return ['curl -fsSL https://claude.ai/install.sh | bash', '# or: npm install -g @anthropic-ai/claude-code'];
  }
  if (tool === 'codex') {
    if (platform === 'darwin' || platform === 'unknown') {
      return ['brew install codex', '# or: npm install -g @openai/codex'];
    }
    // win32 / linux — no first-party package manager one-liner, use npm
    return ['npm install -g @openai/codex'];
  }
  // openspec — npm everywhere (requires Node on PATH)
  return ['npm install -g @fission-ai/openspec'];
}

/** Parse the first `MAJOR.MINOR.PATCH` triple out of arbitrary text. */
export function parseSemver(version: string): [number, number, number] | null {
  const m = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Compare two `MAJOR.MINOR.PATCH` tuples. Returns -1 / 0 / 1.
 */
function compareTuples(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Whether `detected` is >= `required`. Prerelease/build suffixes are ignored
 * (we only compare the numeric triple). If EITHER version is unparseable we
 * return `true` — a present-but-oddly-formatted `--version` must not be
 * falsely flagged as outdated.
 */
export function meetsMinimum(detected: string, required: string): boolean {
  const d = parseSemver(detected);
  const r = parseSemver(required);
  if (!d || !r) return true;
  return compareTuples(d, r) >= 0;
}
