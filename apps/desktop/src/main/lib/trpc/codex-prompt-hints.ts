import { buildCodexApprovedPlanHint, buildCodexOpenspecReadPlanHint } from './codex-mode-prompts';

/**
 * Build the per-turn context hints that tell Codex about read_plan.
 *
 * Extracted so it can be unit-tested without touching the full codex.ts mutation.
 * The callers must still gate `approvedPlanRequired` on hasPlan() + mode; this
 * function just does the string composition.
 */
export function buildCodexReadPlanHints(opts: {
  subChatId: string;
  approvedPlanRequired: boolean;
  openSpecChangeId: string | null;
  mcpToolName: string;
}): string {
  const { subChatId, approvedPlanRequired, openSpecChangeId, mcpToolName } = opts;
  const approvedPlanHint = approvedPlanRequired ? buildCodexApprovedPlanHint(subChatId, mcpToolName) : '';
  const openSpecReadPlanHint = openSpecChangeId
    ? buildCodexOpenspecReadPlanHint(subChatId, openSpecChangeId, mcpToolName)
    : '';
  return [approvedPlanHint, openSpecReadPlanHint].filter(Boolean).join('\n\n');
}
