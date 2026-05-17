export type OpenSpecVerb = 'propose' | 'apply' | 'archive' | 'verify' | 'explore';
export type CliHarness = 'builtin' | 'claude-cli' | 'codex-cli';

const CODEX_NAMES: Record<OpenSpecVerb, string> = {
  propose: '$openspec-propose',
  apply: '$openspec-apply-change',
  archive: '$openspec-archive-change',
  verify: '$openspec-verify-change',
  explore: '$openspec-explore'
};

export function openSpecCommandPrefix(verb: OpenSpecVerb, harness: CliHarness): string {
  return harness === 'codex-cli' ? CODEX_NAMES[verb] : `/opsx:${verb}`;
}

/** Returns true when the line-1 token is a user-typed OpenSpec command for any harness. */
export function isOpenSpecCommandLine(firstLine: string): boolean {
  return firstLine.startsWith('/opsx:') || firstLine.startsWith('$openspec-');
}
