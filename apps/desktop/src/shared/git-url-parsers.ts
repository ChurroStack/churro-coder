/**
 * Pure parsers for repository references. Lives in shared/ so both the main
 * process and the renderer can import them without dragging Node/Electron deps.
 */

/**
 * Parse a GitHub repo reference into owner/repo parts.
 * Accepts HTTPS URL, SSH URL, or short `owner/repo` format.
 * Returns null if the input does not match any known format.
 */
export function parseGitHubRef(input: string): { owner: string; repo: string } | null {
  const https = input.match(/https?:\/\/github\.com\/([^/]+)\/([^/\s]+)/);
  if (https) return { owner: https[1]!, repo: https[2]!.replace(/\.git$/, '') };

  const ssh = input.match(/git@github\.com:([^/]+)\/(.+)/);
  if (ssh) return { owner: ssh[1]!, repo: ssh[2]!.replace(/\.git$/, '') };

  const short = input.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (short) return { owner: short[1]!, repo: short[2]!.replace(/\.git$/, '') };

  return null;
}

/**
 * Parse an Azure DevOps clone URL into org/project/repo parts.
 * Accepts: https://dev.azure.com/<org>/<project>/_git/<repo>
 * Returns null if not a recognised Azure DevOps URL.
 */
export function parseAzureDevOpsRef(input: string): { org: string; project: string; repo: string } | null {
  const m = input.match(/https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/\s]+)/);
  if (!m) return null;
  return { org: m[1]!, project: m[2]!, repo: m[3]!.replace(/\.git$/, '') };
}
