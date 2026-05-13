import { describe, expect, test } from 'vitest';

import {
  buildCodexApprovedPlanHint,
  buildCodexModeInstruction,
  buildCodexOpenspecReadPlanHint
} from './codex-mode-prompts';

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
    const hint = buildCodexApprovedPlanHint('sub-123', 'mcp__churro-coder-dev__read_plan');

    expect(hint).toContain('call `mcp__churro-coder-dev__read_plan` before editing');
    expect(hint).toContain('{ "subChatId": "sub-123" }');
    expect(hint).toContain('do not call the tool without it');
  });
});

describe('buildCodexOpenspecReadPlanHint', () => {
  test('renders sub-chat id and changeId', () => {
    const hint = buildCodexOpenspecReadPlanHint('subc-1', 'add-thing', 'mcp__x__read_plan');

    expect(hint).toContain('Sub-chat id: subc-1');
    expect(hint).toContain('add-thing');
    expect(hint).toContain('mcp__x__read_plan');
  });

  test('renders the exact JSON arg shape the model must emit', () => {
    const hint = buildCodexOpenspecReadPlanHint('subc-1', 'add-thing', 'mcp__x__read_plan');

    expect(hint).toContain('{ "subChatId": "subc-1" }');
  });

  test('does not mention "approved plan"', () => {
    const hint = buildCodexOpenspecReadPlanHint('subc-1', 'add-thing', 'mcp__x__read_plan');

    expect(hint).not.toMatch(/approved plan/i);
  });

  test('warns against passing changeId as subChatId', () => {
    const hint = buildCodexOpenspecReadPlanHint('subc-1', 'add-thing', 'mcp__x__read_plan');

    expect(hint).toMatch(/do not pass the changeId as subChatId/i);
  });

  test('leaves no unrendered template variables', () => {
    const hint = buildCodexOpenspecReadPlanHint('subc-1', 'add-thing', 'mcp__x__read_plan');

    expect(hint).not.toContain('{{');
  });
});
