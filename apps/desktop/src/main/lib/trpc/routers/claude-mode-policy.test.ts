import { describe, expect, test } from 'vitest';

import { evaluateClaudeModeToolPolicy } from './claude-mode-policy';

describe('evaluateClaudeModeToolPolicy — plan mode', () => {
  test('Bash is allowed (falls through to SDK plan-mode contract)', () => {
    expect(evaluateClaudeModeToolPolicy('plan', 'Bash', { command: 'git status' })).toBeNull();
  });

  test('Read / Glob / Grep / WebFetch / WebSearch are allowed', () => {
    expect(evaluateClaudeModeToolPolicy('plan', 'Read', { file_path: 'src/foo.ts' })).toBeNull();
    expect(evaluateClaudeModeToolPolicy('plan', 'Glob', { pattern: '**/*.ts' })).toBeNull();
    expect(evaluateClaudeModeToolPolicy('plan', 'Grep', { pattern: 'foo' })).toBeNull();
    expect(evaluateClaudeModeToolPolicy('plan', 'WebFetch', { url: 'https://example.com' })).toBeNull();
    expect(evaluateClaudeModeToolPolicy('plan', 'WebSearch', { query: 'foo' })).toBeNull();
  });

  test('Edit on .md is allowed (plan documents)', () => {
    expect(evaluateClaudeModeToolPolicy('plan', 'Edit', { file_path: 'plan.md' })).toBeNull();
    expect(evaluateClaudeModeToolPolicy('plan', 'Edit', { file_path: '/tmp/PLAN.MD' })).toBeNull();
  });

  test('Write on .md is allowed (plan documents)', () => {
    expect(evaluateClaudeModeToolPolicy('plan', 'Write', { file_path: 'docs/plan.md' })).toBeNull();
  });

  test('Edit on non-.md is denied with .md-only message', () => {
    const decision = evaluateClaudeModeToolPolicy('plan', 'Edit', { file_path: 'src/foo.ts' });
    expect(decision).toEqual({ deny: true, message: 'Only ".md" files can be modified in plan mode.' });
  });

  test('Write on non-.md is denied with .md-only message', () => {
    const decision = evaluateClaudeModeToolPolicy('plan', 'Write', { file_path: 'README.txt' });
    expect(decision).toEqual({ deny: true, message: 'Only ".md" files can be modified in plan mode.' });
  });

  test('Edit with missing file_path is denied (treated as non-.md)', () => {
    expect(evaluateClaudeModeToolPolicy('plan', 'Edit', {})?.deny).toBe(true);
  });

  test('NotebookEdit is denied', () => {
    const decision = evaluateClaudeModeToolPolicy('plan', 'NotebookEdit', {});
    expect(decision).toEqual({ deny: true, message: 'Tool "NotebookEdit" blocked in plan mode.' });
  });

  test('ExitPlanMode is denied with re-prompt that prevents premature implementation', () => {
    const decision = evaluateClaudeModeToolPolicy('plan', 'ExitPlanMode', {});
    expect(decision?.deny).toBe(true);
    expect(decision?.message).toContain('DONT IMPLEMENT THE PLAN');
    expect(decision?.message).toContain('FINISH CURRENT MESSAGE');
  });
});

describe('evaluateClaudeModeToolPolicy — explore mode', () => {
  test('Bash is allowed (falls through; system prompt communicates read-only contract)', () => {
    expect(evaluateClaudeModeToolPolicy('explore', 'Bash', { command: 'ls' })).toBeNull();
  });

  test('Read / Glob / Grep / WebFetch / WebSearch are allowed', () => {
    expect(evaluateClaudeModeToolPolicy('explore', 'Read', { file_path: 'src/foo.ts' })).toBeNull();
    expect(evaluateClaudeModeToolPolicy('explore', 'Glob', { pattern: '**/*.ts' })).toBeNull();
    expect(evaluateClaudeModeToolPolicy('explore', 'Grep', { pattern: 'foo' })).toBeNull();
    expect(evaluateClaudeModeToolPolicy('explore', 'WebFetch', { url: 'https://example.com' })).toBeNull();
    expect(evaluateClaudeModeToolPolicy('explore', 'WebSearch', { query: 'foo' })).toBeNull();
  });

  test.each(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'ExitPlanMode'])('%s is denied', (toolName) => {
    const decision = evaluateClaudeModeToolPolicy('explore', toolName, { file_path: 'src/foo.ts' });
    expect(decision).toEqual({ deny: true, message: `Tool "${toolName}" blocked in explore mode.` });
  });
});

describe('evaluateClaudeModeToolPolicy — execute mode', () => {
  test('returns null for any tool (no mode-policy gating in execute)', () => {
    expect(evaluateClaudeModeToolPolicy('execute', 'Bash', { command: 'rm -rf' })).toBeNull();
    expect(evaluateClaudeModeToolPolicy('execute', 'Edit', { file_path: 'src/foo.ts' })).toBeNull();
    expect(evaluateClaudeModeToolPolicy('execute', 'Write', { file_path: 'src/foo.ts' })).toBeNull();
    expect(evaluateClaudeModeToolPolicy('execute', 'NotebookEdit', {})).toBeNull();
    expect(evaluateClaudeModeToolPolicy('execute', 'ExitPlanMode', {})).toBeNull();
  });
});
