/**
 * Pure helpers for building the AI SDK `parts` array for the
 * "Implement plan" message that follows plan approval.
 *
 * Layering: pure — no React, no jotai, no tRPC. Used by both the
 * `useApprovePlanDeps` hook and the legacy `handleApprovePlan` body.
 */

// Many models (especially Sonnet) skip TodoWrite for "single deliverable"
// tasks even when the plan has many distinct steps. This instruction nudges
// the model toward native task tracking so the chat UI can show plan-step
// execution without relying on MCP recovery paths.
const IMPLEMENT_PLAN_TASK_TRACKING_INSTRUCTION =
  'Track progress through each plan step using your built-in task-management tool: ' +
  "open a task list at the start and update each item's status " +
  '(pending → in_progress → completed) as you work.';

export const IMPLEMENT_PLAN_BASE_TEXT = `Implement plan. ${IMPLEMENT_PLAN_TASK_TRACKING_INSTRUCTION}`;

export function buildImplementPlanParts(subChatId: string): unknown[] {
  const readPlanInstruction =
    'First, call the `read_plan` tool from the `churro-coder` MCP server to retrieve the approved plan. ' +
    `If the tool requires a \`subChatId\` argument, pass { "subChatId": "${subChatId}" }. Then implement it.`;

  return [{ type: 'text', text: `Implement plan. ${readPlanInstruction} ${IMPLEMENT_PLAN_TASK_TRACKING_INSTRUCTION}` }];
}
