export type CodexSandboxMode = 'plan' | 'execute' | 'explore';

export type CodexSandboxPolicy =
  | { type: 'readOnly' }
  | { type: 'dangerFullAccess' }
  | {
      type: 'workspaceWrite';
      writableRoots: string[];
      networkAccess: boolean;
      excludeTmpdirEnvVar: boolean;
      excludeSlashTmp: boolean;
    };

export function buildCodexSandboxPolicy(
  mode: CodexSandboxMode,
  sandboxEnabled: boolean,
  writableRoots: string[]
): CodexSandboxPolicy {
  if (mode === 'plan' || mode === 'explore') {
    return { type: 'readOnly' };
  }
  if (!sandboxEnabled) {
    return { type: 'dangerFullAccess' };
  }
  return {
    type: 'workspaceWrite',
    writableRoots,
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  };
}

export function buildCodexWorkspaceWriteSandboxPolicy(
  writableRoots: string[]
): Extract<CodexSandboxPolicy, { type: 'workspaceWrite' }> {
  return {
    type: 'workspaceWrite',
    writableRoots,
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  };
}
