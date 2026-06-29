import { execWithShellEnv } from '../../shell-env';

export type AzureDetection =
  | { status: 'ok' }
  | { status: 'missing_cli' }
  | { status: 'missing_extension' }
  | { status: 'error'; message: string };

// Cached for 60s to avoid repeated shell spawns on every PR poll.
let cached: { value: AzureDetection; timestamp: number } | null = null;
const TTL_MS = 60_000;

/**
 * Silent, cached detection of az CLI + azure-devops extension + `az account` auth.
 * Never prompts the user, never auto-installs. Safe to call from polling queries.
 */
export async function detectAzureCli(): Promise<AzureDetection> {
  if (cached && Date.now() - cached.timestamp < TTL_MS) {
    return cached.value;
  }
  const value = await runDetection();
  cached = { value, timestamp: Date.now() };
  return value;
}

/** Drop the cached detection result (e.g. after the user installs `az`). */
export function invalidateAzureDetection(): void {
  cached = null;
}

async function runDetection(): Promise<AzureDetection> {
  // 1. `az` on PATH?
  try {
    await execWithShellEnv('which', ['az']);
  } catch {
    return { status: 'missing_cli' };
  }

  // 2. azure-devops extension installed?
  try {
    const { stdout } = await execWithShellEnv('az', [
      'extension',
      'list',
      '--query',
      "[?name=='azure-devops'].name",
      '-o',
      'tsv'
    ]);
    if (!stdout.trim()) {
      return { status: 'missing_extension' };
    }
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err)
    };
  }

  // 3. Verify the azure-devops extension is usable (covers both Azure AD and PAT
  //    auth flows). We intentionally avoid `az account show` here because that
  //    requires an Azure subscription login (`az login`) and fails for users who
  //    only authenticate via PAT (`az devops login`) or AZURE_DEVOPS_EXT_PAT.
  //    `az devops configure --list` succeeds as long as the extension is wired up,
  //    regardless of auth method. Real auth errors are surfaced downstream by
  //    `az repos pr list` when it actually talks to the org.
  try {
    await execWithShellEnv('az', ['devops', 'configure', '--list']);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'error', message: msg };
  }

  return { status: 'ok' };
}

/** Human-readable toast text for a detection failure. Used by mutations. */
export function detectionToToastMessage(d: AzureDetection): string {
  switch (d.status) {
    case 'ok':
      return '';
    case 'missing_cli':
      return 'Azure CLI not found. Install from https://aka.ms/install-az and retry.';
    case 'missing_extension':
      return 'Azure DevOps extension missing. Run: az extension add --name azure-devops';
    case 'error':
      return d.message;
  }
}
