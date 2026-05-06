import { describe, expect, test } from 'vitest';

import { createTaskListPartFromPlan } from './codex-plan-task-part';

describe('createTaskListPartFromPlan', () => {
  test('converts structured plan steps into a TaskList part', () => {
    const part = createTaskListPartFromPlan({
      itemId: 'plan-1',
      startedAt: 123,
      plan: {
        steps: [
          { id: 'inspect', title: 'Inspect handoff flow', description: 'Find the source', status: 'pending' },
          { id: 'ship', title: 'Ship fix', status: 'in_progress' },
          { id: 'verify', title: 'Verify behavior', status: 'completed' }
        ]
      }
    });

    expect(part).toMatchObject({
      type: 'tool-TaskList',
      toolCallId: 'plan-1',
      toolName: 'TaskList',
      state: 'output-available',
      input: {},
      output: {
        tasks: [
          {
            id: 'inspect',
            subject: 'Inspect handoff flow',
            description: 'Find the source',
            status: 'pending'
          },
          { id: 'ship', subject: 'Ship fix', status: 'in_progress' },
          { id: 'verify', subject: 'Verify behavior', status: 'completed' }
        ]
      },
      result: {
        tasks: [
          { id: 'inspect', subject: 'Inspect handoff flow', description: 'Find the source', status: 'pending' },
          { id: 'ship', subject: 'Ship fix', status: 'in_progress' },
          { id: 'verify', subject: 'Verify behavior', status: 'completed' }
        ]
      },
      startedAt: 123
    });
  });

  test('supports Codex array plan shape and maps inProgress status', () => {
    const part = createTaskListPartFromPlan({
      itemId: 'plan-array',
      plan: [
        { step: 'Read relevant files', status: 'inProgress' },
        { title: 'Add tests', description: 'Cover task conversion' },
        {}
      ]
    });

    expect(part.output.tasks).toEqual([
      { id: 'step-1', subject: 'Read relevant files', status: 'in_progress' },
      { id: 'step-2', subject: 'Add tests', description: 'Cover task conversion', status: 'pending' },
      { id: 'step-3', subject: 'Task 3', status: 'pending' }
    ]);
  });

  test('falls back to parsing numbered and bulleted text plans', () => {
    const part = createTaskListPartFromPlan({
      itemId: 'text-plan',
      text: [
        'Task list:',
        '1. Inspect duplicate recovery hints.',
        '- Add a focused guard.',
        '* Verify tests pass.'
      ].join('\n')
    });

    expect(part.output.tasks).toEqual([
      { id: 'step-1', subject: 'Inspect duplicate recovery hints.', status: 'pending' },
      { id: 'step-2', subject: 'Add a focused guard.', status: 'pending' },
      { id: 'step-3', subject: 'Verify tests pass.', status: 'pending' }
    ]);
  });

  test('returns an empty TaskList for empty input instead of a PlanWrite fallback', () => {
    const part = createTaskListPartFromPlan({ itemId: 'empty' });

    expect(part.type).toBe('tool-TaskList');
    expect(part.output.tasks).toEqual([]);
  });
});
