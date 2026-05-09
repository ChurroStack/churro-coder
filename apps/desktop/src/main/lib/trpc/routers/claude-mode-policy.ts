export type ClaudeMode = 'plan' | 'execute' | 'explore';

export type ClaudeModeToolDeny = { deny: true; message: string };

export const PLAN_MODE_BLOCKED_TOOLS: ReadonlySet<string> = new Set(['NotebookEdit']);

const EXPLORE_MODE_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
  'Edit',
  'Write',
  'NotebookEdit',
  'MultiEdit',
  'ExitPlanMode'
]);

const EXIT_PLAN_MODE_REPROMPT =
  'IMPORTANT: DONT IMPLEMENT THE PLAN UNTIL THE EXPLIT COMMAND. THE PLAN WAS **ONLY** PRESENTED TO USER, FINISH CURRENT MESSAGE AS SOON AS POSSIBLE';

export function evaluateClaudeModeToolPolicy(
  mode: ClaudeMode,
  toolName: string,
  toolInput: Record<string, unknown>
): ClaudeModeToolDeny | null {
  if (mode === 'explore') {
    if (EXPLORE_MODE_BLOCKED_TOOLS.has(toolName)) {
      return { deny: true, message: `Tool "${toolName}" blocked in explore mode.` };
    }
    return null;
  }

  if (mode === 'plan') {
    if (toolName === 'Edit' || toolName === 'Write') {
      const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
      if (!/\.md$/i.test(filePath)) {
        return { deny: true, message: 'Only ".md" files can be modified in plan mode.' };
      }
      return null;
    }
    if (toolName === 'ExitPlanMode') {
      return { deny: true, message: EXIT_PLAN_MODE_REPROMPT };
    }
    if (PLAN_MODE_BLOCKED_TOOLS.has(toolName)) {
      return { deny: true, message: `Tool "${toolName}" blocked in plan mode.` };
    }
    return null;
  }

  return null;
}
