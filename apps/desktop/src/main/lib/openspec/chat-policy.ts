import path from 'node:path';

const OPEN_SPEC_STEP_PREFIX_RE = /^\[step:(proposal|design|tasks)\]\s*\n/;
const OPEN_SPEC_WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

export const OPEN_SPEC_CODEX_RESTRICTED_TOOLS = [
  'Bash',
  'Edit',
  'Write',
  'Read',
  'Glob',
  'Grep',
  'Thinking',
  'WebSearch',
  'WebFetch',
  'AskUserQuestion'
];

export function stripOpenSpecStepPrefix(prompt: string): string {
  return prompt.trimStart().replace(OPEN_SPEC_STEP_PREFIX_RE, '').trimStart();
}

export function isOpenSpecApplyPrompt(prompt: string): boolean {
  const stripped = stripOpenSpecStepPrefix(prompt);
  return /^\/opsx:apply(?:\s|$)/.test(stripped) || /^Implement tasks from an OpenSpec change\./.test(stripped);
}

export function evaluateOpenSpecToolPolicy(params: {
  openSpecWriteRoot?: string | null;
  openSpecChangePath?: string;
  isApplyTurn: boolean;
  cwd: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}): { behavior: 'deny'; message: string } | null {
  if (!params.openSpecWriteRoot || params.isApplyTurn) return null;

  if (!OPEN_SPEC_WRITE_TOOLS.has(params.toolName)) return null;

  const fp = typeof params.toolInput.file_path === 'string' ? params.toolInput.file_path : '';
  const resolvedFp = fp ? path.resolve(params.cwd, fp) : '';
  if (resolvedFp === params.openSpecWriteRoot || resolvedFp.startsWith(params.openSpecWriteRoot + path.sep)) {
    return null;
  }

  return {
    behavior: 'deny',
    message: `OpenSpec sidebar writes are limited to ${params.openSpecChangePath ?? params.openSpecWriteRoot} unless the turn is /opsx:apply.`
  };
}

export function resolveOpenSpecCodexToolConfig(params: {
  openSpecWriteRoot?: string | null;
  isApplyTurn: boolean;
  defaultBuiltInTools: string[];
  defaultWritableRoots: string[];
  defaultSandboxEnabled: boolean;
}): {
  builtInTools: string[];
  writableRoots: string[];
  sandboxEnabled: boolean;
  forceWritableRoots?: string[];
} {
  if (!params.openSpecWriteRoot || params.isApplyTurn) {
    return {
      builtInTools: params.defaultBuiltInTools,
      writableRoots: params.defaultWritableRoots,
      sandboxEnabled: params.defaultSandboxEnabled
    };
  }

  return {
    builtInTools: OPEN_SPEC_CODEX_RESTRICTED_TOOLS,
    writableRoots: [params.openSpecWriteRoot, ...params.defaultWritableRoots],
    sandboxEnabled: true,
    forceWritableRoots: [params.openSpecWriteRoot, ...params.defaultWritableRoots]
  };
}
