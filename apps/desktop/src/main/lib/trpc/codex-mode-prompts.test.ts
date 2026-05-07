import { describe, expect, test } from 'vitest';

import { buildCodexApprovedPlanHint, buildCodexModeInstruction } from './codex-mode-prompts';

describe('buildCodexModeInstruction', () => {
  test('plan mode says PlanWrite is the native plan path and MCP is not required', () => {
    const prompt = buildCodexModeInstruction('plan');

    expect(prompt).toContain('create the plan with PlanWrite');
    expect(prompt).toContain('Do not rely on MCP to create the plan or a task list.');
    expect(prompt).toContain('Call PlanWrite exactly once');
  });

  test('execute mode scopes MCP to approved-plan recovery only', () => {
    const prompt = buildCodexModeInstruction('execute');

    expect(prompt).toContain('Use Codex-native task-management tools');
    expect(prompt).toContain('Do not call PlanWrite');
    expect(prompt).toContain('Use the read_plan MCP tool only when you need to recover the already-approved plan');
  });

  test('explore mode forbids edits and tells the model to stop after reporting findings', () => {
    const prompt = buildCodexModeInstruction('explore');

    expect(prompt).toContain('[EXPLORE MODE]');
    expect(prompt).toContain('read-only');
    expect(prompt).toContain('Do not call PlanWrite');
    expect(prompt).not.toContain('Implement changes');
  });
});

describe('buildCodexApprovedPlanHint', () => {
  test('keeps exact read_plan call shape while clarifying MCP is recovery-only', () => {
    const hint = buildCodexApprovedPlanHint('sub-123');

    expect(hint).toContain('Only call the `read_plan` MCP tool when you need to recover the approved plan');
    expect(hint).toContain('{ "subChatId": "sub-123" }');
    expect(hint).toContain('do not call read_plan without it');
  });
});
