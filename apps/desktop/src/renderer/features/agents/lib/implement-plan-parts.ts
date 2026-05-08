/**
 * Pure helpers for building the AI SDK `parts` array for the
 * "Implement plan" message that follows plan approval.
 *
 * Layering: pure — no React, no jotai, no tRPC. Used by both the
 * `useApprovePlanDeps` hook and the legacy `handleApprovePlan` body.
 */
import { renderBuiltinPrompt } from '../../../../prompts/render';

export const IMPLEMENT_PLAN_BASE_TEXT = renderBuiltinPrompt('workflow/implement-plan-base');

export function buildImplementPlanParts(subChatId: string): unknown[] {
  return [{ type: 'text', text: renderBuiltinPrompt('workflow/implement-plan', { subChatId }) }];
}
