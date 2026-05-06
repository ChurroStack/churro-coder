import { describe, expect, test } from 'vitest';

import { buildImplementPlanParts, IMPLEMENT_PLAN_BASE_TEXT } from './implement-plan-parts';

describe('buildImplementPlanParts', () => {
  test('same-provider path stays text-only and emphasizes native task tracking', () => {
    const parts = buildImplementPlanParts(null) as Array<{ type: string; text?: string }>;

    expect(parts).toEqual([{ type: 'text', text: IMPLEMENT_PLAN_BASE_TEXT }]);
    expect(IMPLEMENT_PLAN_BASE_TEXT).toContain('built-in task-management tool');
  });

  test('cross-provider path scopes read_plan to recovery only', () => {
    const parts = buildImplementPlanParts({
      content: '# Plan\n\n1. Ship it',
      source: 'codex:PlanWrite'
    }) as Array<{ type: string; text?: string; content?: string }>;

    expect(parts).toHaveLength(2);
    expect(parts[0].text).toContain('Use the attached approved plan as the source of truth.');
    expect(parts[0].text).toContain('Only use the `read_plan` MCP tool');
    expect(parts[1].content).toContain('Plan source: codex:PlanWrite');
  });
});
