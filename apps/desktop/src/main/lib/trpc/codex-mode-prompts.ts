import { renderBuiltinPrompt } from '../../../prompts/render';
import { getAppOwnedChurroCoderReadPlanToolName } from './codex-mcp-auth';

export function buildCodexModeInstruction(mode: 'plan' | 'execute' | 'explore'): string {
  return renderBuiltinPrompt(`mode/${mode}`);
}

export function buildCodexApprovedPlanHint(
  subChatId: string,
  mcpToolName = getAppOwnedChurroCoderReadPlanToolName()
): string {
  return renderBuiltinPrompt('mode/codex-approved-plan-hint', { subChatId, mcpToolName });
}

export function buildCodexOpenspecReadPlanHint(
  subChatId: string,
  changeId: string,
  mcpToolName = getAppOwnedChurroCoderReadPlanToolName()
): string {
  return renderBuiltinPrompt('mode/codex-openspec-read-plan-hint', { subChatId, changeId, mcpToolName });
}
