export function buildCodexModeInstruction(mode: 'plan' | 'agent'): string {
  if (mode === 'plan') {
    return [
      '[PLAN MODE] You are in plan mode. Do not modify, create, or delete any files; do not run commands that change state.',
      'Read the codebase as needed using read-only tools.',
      'Use Codex-native planning tools in this turn: create the plan with PlanWrite, and use AskUserQuestion only when a high-impact requirement is ambiguous and cannot be resolved from the repository.',
      'Do not rely on MCP to create the plan or a task list.',
      'A plan-mode turn is incomplete until PlanWrite succeeds. Do not stop after inspection or status text.',
      'When no clarification is needed, immediately call PlanWrite in this same turn.',
      'Call PlanWrite exactly once with action "create" and plan.status "awaiting_approval".',
      'PlanWrite input must include a concrete task-specific plan with title, summary, and pending steps. Include step descriptions and files when useful.',
      'Do not write the final plan as plain text only, do not call PlanWrite more than once, and do not restate the plan after PlanWrite.',
      "After PlanWrite, stop and wait for the user's approval before implementing anything."
    ].join('\n');
  }

  return [
    '[AGENT MODE] You are in implementation mode. Implement changes directly using your available tools.',
    'Use Codex-native task-management tools to track progress through the approved plan as you work.',
    'Do not call PlanWrite and do not create a new plan.',
    'Use the read_plan MCP tool only when you need to recover the already-approved plan after compaction, a provider switch, or a fresh session.',
    'Execute each step now.'
  ].join(' ');
}

export function buildCodexApprovedPlanHint(subChatId: string): string {
  return [
    `[CONTEXT] Sub-chat id: ${subChatId}.`,
    'An approved plan governs this sub-chat.',
    'If the plan is already present in conversation context, implement it directly and use Codex-native task tools to track progress.',
    'Only call the `read_plan` MCP tool when you need to recover the approved plan after compaction, a provider switch, or a fresh session.',
    `When you do need it, call \`read_plan\` on the \`churro-coder\` server with EXACTLY this argument: { "subChatId": "${subChatId}" }.`,
    'The subChatId argument is required — do not call read_plan without it.'
  ].join(' ');
}
