import { describe, expect, test } from 'vitest';

import { buildCodexReadPlanHints } from './codex-prompt-hints';

const TOOL = 'mcp__churro-coder__read_plan';

describe('buildCodexReadPlanHints', () => {
  test('openspec bound, no file plan → emits ONLY the openspec hint with subChatId UUID', () => {
    const result = buildCodexReadPlanHints({
      subChatId: 'uuid-sub-1',
      approvedPlanRequired: false,
      openSpecChangeId: 'add-thing',
      mcpToolName: TOOL
    });

    expect(result).toContain('Sub-chat id: uuid-sub-1');
    expect(result).toContain('add-thing');
    expect(result).toContain('{ "subChatId": "uuid-sub-1" }');
    expect(result).not.toMatch(/approved plan/i);
  });

  test('openspec bound AND file plan → emits both hints', () => {
    const result = buildCodexReadPlanHints({
      subChatId: 'uuid-sub-2',
      approvedPlanRequired: true,
      openSpecChangeId: 'add-thing',
      mcpToolName: TOOL
    });

    expect(result).toContain('approved plan');
    expect(result).toContain('add-thing');
    expect(result).toContain('Sub-chat id: uuid-sub-2');
  });

  test('no openspec, file plan → emits ONLY the approved-plan hint', () => {
    const result = buildCodexReadPlanHints({
      subChatId: 'uuid-sub-3',
      approvedPlanRequired: true,
      openSpecChangeId: null,
      mcpToolName: TOOL
    });

    expect(result).toContain('approved plan');
    expect(result).not.toContain('OpenSpec');
  });

  test('no openspec, no file plan → emits nothing', () => {
    const result = buildCodexReadPlanHints({
      subChatId: 'uuid-sub-4',
      approvedPlanRequired: false,
      openSpecChangeId: null,
      mcpToolName: TOOL
    });

    expect(result).toBe('');
  });

  test('regression: changeId is NOT used as subChatId in the hint', () => {
    const result = buildCodexReadPlanHints({
      subChatId: 'uuid-sub-5',
      approvedPlanRequired: false,
      openSpecChangeId: 'add-currently-when-opening',
      mcpToolName: TOOL
    });

    // The arg object must carry the UUID, not the changeId
    expect(result).toContain('{ "subChatId": "uuid-sub-5" }');
    expect(result).not.toContain('{ "subChatId": "add-currently-when-opening" }');
  });
});
