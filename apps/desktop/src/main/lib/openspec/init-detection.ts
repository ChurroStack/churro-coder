import fs from 'node:fs/promises';
import path from 'node:path';

export type OpenspecTool = 'claude' | 'codex';

export type OpenspecState =
  | 'uninitialized' // no openspec/ dir at all
  | 'tools-missing' // openspec/ exists but some tool sentinels are absent
  | 'ok'; // everything present

export interface OpenspecDetectionResult {
  state: OpenspecState;
  hasOpenspecDir: boolean;
  missingTools: OpenspecTool[];
}

/** Sentinel files the CLI emits per tool (relative to targetRoot). */
const TOOL_SENTINELS: Record<OpenspecTool, string> = {
  claude: '.claude/skills/openspec-propose/SKILL.md',
  codex: '.codex/skills/openspec-propose/SKILL.md'
};

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Probes targetRoot to determine the OpenSpec initialisation state.
 * @param targetRoot absolute path to the worktree / project root
 * @param tools      the tools the user has selected (defaults to claude + codex)
 */
export async function detectOpenspecState(
  targetRoot: string,
  tools: OpenspecTool[] = ['claude', 'codex']
): Promise<OpenspecDetectionResult> {
  const hasOpenspecDir = await fileExists(path.join(targetRoot, 'openspec'));

  const missingTools: OpenspecTool[] = [];
  for (const tool of tools) {
    const sentinel = TOOL_SENTINELS[tool];
    if (sentinel && !(await fileExists(path.join(targetRoot, sentinel)))) {
      missingTools.push(tool);
    }
  }

  let state: OpenspecState;
  if (!hasOpenspecDir) {
    state = 'uninitialized';
  } else if (missingTools.length > 0) {
    state = 'tools-missing';
  } else {
    state = 'ok';
  }

  return { state, hasOpenspecDir, missingTools };
}
