import { renderBuiltinPrompt } from '../../../prompts/render';

export function buildCodexModeInstruction(mode: 'plan' | 'execute' | 'explore'): string {
  return renderBuiltinPrompt(`mode/${mode}`);
}

export function buildCodexApprovedPlanHint(subChatId: string): string {
  return renderBuiltinPrompt('mode/codex-approved-plan-hint', { subChatId });
}
