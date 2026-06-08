// @vitest-environment jsdom
/**
 * Regression for "Subagent interrupted" shown for a *running* CLI subagent.
 *
 * The visible verdict for a Task/Agent tool with no output yet is decided
 * entirely by `chatStatus` (via getToolStatus): a pending Task renders
 * "Subagent interrupted" when the status is non-streaming, but "Running
 * Subagent" while the turn is active. The CLI conversation pane used to feed a
 * hardcoded 'ready' status to non-last messages, so a long-running subagent
 * (whose Task part legitimately sits at 'input-available' for minutes) rendered
 * as interrupted. The fix feeds a dedicated 'turn-active' status to non-last
 * messages while the CLI sub-chat's turn is running; this test pins the
 * status→text contract that fix relies on.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../../../test-utils';
import { AgentTaskTool } from './agent-task-tool';

const pendingTaskPart = {
  type: 'tool-Task',
  toolCallId: 'task-1',
  input: { description: 'investigate the thing', subagent_type: 'Explore' },
  state: 'input-available' as const
};

afterEach(cleanup);

describe('AgentTaskTool — running vs interrupted [chat/cli-subagent-status]', () => {
  test('renders "Subagent interrupted" for a pending Task when the chat is idle (ready)', () => {
    renderWithProviders(<AgentTaskTool part={pendingTaskPart} nestedTools={[]} chatStatus="ready" />);
    // getByText throws if absent, so this asserts presence.
    expect(screen.getByText('Subagent interrupted')).toBeTruthy();
    expect(screen.queryByText('Running Subagent')).toBeNull();
  });

  test('renders "Running Subagent" (NOT interrupted) for a pending Task while the chat is streaming', () => {
    renderWithProviders(<AgentTaskTool part={pendingTaskPart} nestedTools={[]} chatStatus="streaming" />);
    expect(screen.getByText('Running Subagent')).toBeTruthy();
    expect(screen.queryByText('Subagent interrupted')).toBeNull();
  });

  test('renders "Running Subagent" for a non-last pending Task while the CLI turn is active', () => {
    // 'turn-active' is what NonStreamingMessageItem feeds a non-last message while
    // the CLI sub-chat is mid-turn — the exact case the fix targets.
    renderWithProviders(<AgentTaskTool part={pendingTaskPart} nestedTools={[]} chatStatus="turn-active" />);
    expect(screen.getByText('Running Subagent')).toBeTruthy();
    expect(screen.queryByText('Subagent interrupted')).toBeNull();
  });

  test('a Task with output is never "interrupted", even when idle', () => {
    const completed = {
      ...pendingTaskPart,
      state: 'output-available' as const,
      output: { content: [{ type: 'text', text: 'done' }] }
    };
    renderWithProviders(<AgentTaskTool part={completed} nestedTools={[]} chatStatus="ready" />);
    expect(screen.queryByText('Subagent interrupted')).toBeNull();
    expect(screen.getByText('Completed Subagent')).toBeTruthy();
  });
});
