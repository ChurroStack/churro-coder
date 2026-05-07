import { describe, expect, test } from 'vitest';

import { buildImplementPlanParts, IMPLEMENT_PLAN_BASE_TEXT } from './implement-plan-parts';

describe('buildImplementPlanParts', () => {
  test('returns exactly one text part and emphasizes read_plan + native task tracking', () => {
    const parts = buildImplementPlanParts('sub-123') as Array<{ type: string; text?: string }>;

    expect(parts).toHaveLength(1);
    expect(parts[0].text).toContain('read_plan');
    expect(parts[0].text).toContain('churro-coder');
    expect(parts[0].text).toContain('{ "subChatId": "sub-123" }');
    expect(parts[0].text).toContain('If the tool requires a `subChatId` argument');
    expect(IMPLEMENT_PLAN_BASE_TEXT).toContain('built-in task-management tool');
    expect(parts.some((part) => part.type === 'file-content')).toBe(false);
  });
});
