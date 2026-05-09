import { describe, expect, test } from 'vitest';

import { buildCodexApprovedPlanHint, buildCodexModeInstruction } from './codex-mode-prompts';

describe('buildCodexModeInstruction', () => {
  test('plan mode says PlanWrite is the native plan path and MCP is not required', () => {
    const prompt = buildCodexModeInstruction('plan');

    expect(prompt).toContain('create the plan with PlanWrite');
    expect(prompt).toContain('You may run read-only shell commands');
    expect(prompt).toContain('use WebFetch/WebSearch to gather context');
    expect(prompt).toContain('Do not rely on MCP to create the plan or a task list.');
    expect(prompt).toContain('Call PlanWrite exactly once');
  });

  test('execute mode scopes MCP to approved-plan recovery only', () => {
    const prompt = buildCodexModeInstruction('execute');

    expect(prompt).toContain('Use Codex-native task-management tools');
    expect(prompt).toContain('Do not call PlanWrite');
    expect(prompt).toContain('call the read_plan MCP tool before editing');
    expect(prompt).toContain('For ordinary follow-up requests, use read_plan only');
  });

  test('explore mode forbids edits and tells the model to stop after reporting findings', () => {
    const prompt = buildCodexModeInstruction('explore');

    expect(prompt).toContain('[EXPLORE MODE]');
    expect(prompt).toContain('read-only');
    expect(prompt).toContain('You may run read-only shell commands');
    expect(prompt).toContain('use WebFetch/WebSearch to gather context');
    expect(prompt).toContain('Do not call PlanWrite');
    expect(prompt).not.toContain('Implement changes');
  });
});

describe('buildCodexApprovedPlanHint', () => {
  test('keeps exact read_plan call shape for implement-plan turns', () => {
    const hint = buildCodexApprovedPlanHint('sub-123');

    expect(hint).toContain('For an implement-plan turn, call `read_plan` before editing');
    expect(hint).toContain('{ "subChatId": "sub-123" }');
    expect(hint).toContain('do not call read_plan without it');
  });
});
