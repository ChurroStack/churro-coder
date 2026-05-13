import { describe, expect, test } from 'vitest';
import { expandOpenSpecCommand } from './openspec-command-expander';

describe('expandOpenSpecCommand', () => {
  test('expands OpenSpec built-in commands to rendered prompt content', () => {
    const expanded = expandOpenSpecCommand('/opsx:verify');

    expect(expanded).toContain('Verify that an implementation matches the change artifacts');
    expect(expanded).not.toContain('{#');
  });

  test('passes apply scope arguments into the rendered prompt', () => {
    const expanded = expandOpenSpecCommand('/opsx:apply 1.3');

    expect(expanded).toContain('Implement tasks from an OpenSpec change.');
    expect(expanded).toContain('**Scope argument from Churro Coder UI**: `1.3`');
    expect(expanded).toContain('implement only that specific task');
    expect(expanded).not.toContain('$ARGUMENTS');
    expect(expanded).not.toContain('{#');
  });

  test('leaves non-OpenSpec messages unchanged', () => {
    expect(expandOpenSpecCommand('Please refine the proposal')).toBe('Please refine the proposal');
  });
});
