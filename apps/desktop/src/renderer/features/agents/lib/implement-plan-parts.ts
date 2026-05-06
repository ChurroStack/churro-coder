/**
 * Pure helpers for building the AI SDK `parts` array for the
 * "Implement plan" message that follows plan approval.
 *
 * Same-provider approvals get a text-only message; the SDK already has
 * the plan in session history (`exitPlan: true` cleared sessionId, but
 * the plan content stays accessible to the model via the new session).
 *
 * Cross-provider approvals (Claude→Codex / Codex→Claude) need the plan
 * re-attached as a hidden file part because the new provider's session
 * has no history.
 *
 * Layering: pure — no React, no jotai, no tRPC. Used by both the
 * `useApprovePlanDeps` hook and the legacy `handleApprovePlan` body.
 */

export interface ApprovedPlanContent {
  content: string;
  source?: string;
}

// Many models (especially Sonnet) skip TodoWrite for "single deliverable"
// tasks even when the plan has many distinct steps. This instruction gives
// the model a nudge to use task tracking, which makes the chat UI more
// useful — the user can see the plan's structure as the agent executes
// because the message stream has events to display.
const IMPLEMENT_PLAN_TASK_TRACKING_INSTRUCTION =
  'Track progress through each plan step using your task-management tool: ' +
  "open a task list at the start and update each item's status " +
  '(pending → in_progress → completed) as you work.';

export const IMPLEMENT_PLAN_BASE_TEXT = `Implement plan. ${IMPLEMENT_PLAN_TASK_TRACKING_INSTRUCTION}`;

/**
 * Build the AI SDK message parts for "Implement plan".
 *
 * @param plan - the approved plan content + optional source label, or
 *   `null` when no plan content is available (cross-provider approve
 *   that failed to resolve, or same-provider where the SDK already has
 *   the plan in history).
 * @returns text-only parts when `plan` is null/empty; text + file-content
 *   parts when the plan needs to be re-attached.
 */
export function buildImplementPlanParts(plan: ApprovedPlanContent | null): unknown[] {
  const content = plan?.content.trim();
  if (!plan || !content) {
    return [{ type: 'text', text: IMPLEMENT_PLAN_BASE_TEXT }];
  }

  const source = plan.source ? `Plan source: ${plan.source}` : '';
  const hiddenPlanContent = [
    'Approved plan for implementation.',
    'Use this plan text as the source of truth even if it was written by a different provider or model.',
    source,
    '',
    content
  ].join('\n');

  return [
    {
      type: 'text',
      text: `${IMPLEMENT_PLAN_BASE_TEXT} Use the attached approved plan as the source of truth. The plan is also retrievable via the \`read_plan\` MCP tool (server: churro-coder) if this conversation is later compacted.`
    },
    {
      type: 'file-content',
      filePath: 'approved-plan.md',
      content: hiddenPlanContent
    }
  ];
}
