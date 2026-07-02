import { describe, expect, test } from 'vitest';
import { isMachineInjectedUserText } from './message-parts';

// Regression coverage for the Session widget "Last input" bug: Claude Code
// writes background sub-agent (Task tool) completion pings and interrupt
// markers into the JSONL transcript as plain `role='user'` records. Without
// this filter, `getSessionPrompts` (main/lib/trpc/routers/messages.ts) picks
// one of these as "last input" instead of the user's real last typed prompt.
describe('isMachineInjectedUserText', () => {
  test('flags a task-notification (background sub-agent completion ping)', () => {
    const text =
      '<task-notification>\n<task-id>abc123</task-id>\n<tool-use-id>toolu_01</tool-use-id>\n</task-notification>';
    expect(isMachineInjectedUserText(text)).toBe(true);
  });

  test('flags a bare task-id tag', () => {
    expect(isMachineInjectedUserText('<task-id>abc123</task-id>')).toBe(true);
  });

  test('flags a system-reminder block', () => {
    expect(isMachineInjectedUserText('<system-reminder>Some internal note</system-reminder>')).toBe(true);
  });

  test('flags an interrupt marker', () => {
    expect(isMachineInjectedUserText('[Request interrupted by user]')).toBe(true);
  });

  test('flags an interrupt-during-tool-use marker', () => {
    expect(isMachineInjectedUserText('[Request interrupted by user for tool use]')).toBe(true);
  });

  test('tolerates leading whitespace', () => {
    expect(isMachineInjectedUserText('  \n<task-notification>...</task-notification>')).toBe(true);
  });

  test('does not flag a genuine user prompt', () => {
    expect(isMachineInjectedUserText('Merge latest from main into the current branch and resolve conflicts.')).toBe(
      false
    );
  });

  test('does not flag a prompt that merely mentions a task', () => {
    expect(isMachineInjectedUserText('Please check on the background task status')).toBe(false);
  });
});
