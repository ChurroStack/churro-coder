import { describe, it, expect } from 'vitest';
import { createMapperState, mapClaudeLine, mapCodexLine } from './jsonl-mapper';

describe('jsonl-mapper / Claude', () => {
  it('maps an assistant text message into a single text part', () => {
    const state = createMapperState();
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'u-1',
      timestamp: '2026-05-27T15:00:00Z',
      message: {
        id: 'msg-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello there' }]
      }
    });
    const r = mapClaudeLine(line, state);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].uuid).toBe('u-1');
    expect(r.messages[0].role).toBe('assistant');
    expect(r.messages[0].parts).toEqual([{ type: 'text', text: 'Hello there' }]);
    expect(r.sideEffects).toEqual([]);
  });

  it('drops malformed JSON without throwing', () => {
    const r = mapClaudeLine('{not json', createMapperState());
    expect(r.messages).toEqual([]);
    expect(r.sideEffects).toEqual([]);
  });

  it('skips informational event types', () => {
    const state = createMapperState();
    for (const type of ['bridge-session', 'last-prompt', 'permission-mode', 'system']) {
      const r = mapClaudeLine(JSON.stringify({ type }), state);
      expect(r.messages).toEqual([]);
    }
  });

  it('merges a tool_result into the prior tool_use by tool_use_id', () => {
    const state = createMapperState();
    const useLine = JSON.stringify({
      type: 'assistant',
      uuid: 'u-2',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'ls' } }]
      }
    });
    const r1 = mapClaudeLine(useLine, state);
    expect(r1.messages[0].parts[0]).toMatchObject({
      type: 'tool-Bash',
      toolCallId: 'call-1',
      state: 'input-available',
      input: { command: 'ls' }
    });

    const resultLine = JSON.stringify({
      type: 'user',
      uuid: 'u-3',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'README.md\nsrc/' }]
      }
    });
    mapClaudeLine(resultLine, state);
    // The merged result mutates the prior part (held by ref in state).
    expect(r1.messages[0].parts[0]).toMatchObject({
      state: 'output-available',
      output: 'README.md\nsrc/'
    });
  });

  it('emits a file-change side-effect for Edit', () => {
    const r = mapClaudeLine(
      JSON.stringify({
        type: 'assistant',
        uuid: 'u-4',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'call-edit',
              name: 'Edit',
              input: { file_path: '/repo/src/foo.ts', old_string: 'a', new_string: 'b' }
            }
          ]
        }
      }),
      createMapperState()
    );
    expect(r.sideEffects).toEqual([{ kind: 'file-change', path: '/repo/src/foo.ts', action: 'update' }]);
  });

  it('emits a plan side-effect when mcp__churro-coder__write_plan is called', () => {
    const r = mapClaudeLine(
      JSON.stringify({
        type: 'assistant',
        uuid: 'u-5',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'call-plan',
              name: 'mcp__churro-coder__write_plan',
              input: { markdown: '# Plan\nDo a thing', title: 'Plan' }
            }
          ]
        }
      }),
      createMapperState()
    );
    expect(r.sideEffects).toEqual([{ kind: 'plan', markdown: '# Plan\nDo a thing', title: 'Plan' }]);
  });

  it('emits a plan side-effect when the CLI native ExitPlanMode is called', () => {
    const r = mapClaudeLine(
      JSON.stringify({
        type: 'assistant',
        uuid: 'u-6',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'call-exit-plan',
              name: 'ExitPlanMode',
              input: { plan: '# Plan: Simple blue HTML page\n\n## Context\nUser requested...' }
            }
          ]
        }
      }),
      createMapperState()
    );
    expect(r.messages[0].parts[0]).toMatchObject({
      type: 'tool-ExitPlanMode',
      toolCallId: 'call-exit-plan'
    });
    expect(r.sideEffects).toEqual([
      { kind: 'plan', markdown: '# Plan: Simple blue HTML page\n\n## Context\nUser requested...' }
    ]);
  });

  it('emits no plan side-effect for ExitPlanMode with empty input', () => {
    // Real-world JSONL: ~35% of ExitPlanMode entries have input: {} (no plan field).
    const r = mapClaudeLine(
      JSON.stringify({
        type: 'assistant',
        uuid: 'u-7',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'call-empty', name: 'ExitPlanMode', input: {} }]
        }
      }),
      createMapperState()
    );
    expect(r.messages[0].parts[0]).toMatchObject({ type: 'tool-ExitPlanMode' });
    expect(r.sideEffects).toEqual([]);
  });
});

describe('jsonl-mapper / Codex', () => {
  it('maps a response_item message with output_text', () => {
    const r = mapCodexLine(
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-05-27T15:00:00Z',
        payload: {
          type: 'message',
          id: 'msg-c-1',
          role: 'assistant',
          content: [
            { type: 'output_text', text: 'hi' },
            { type: 'output_text', text: 'world' }
          ]
        }
      }),
      createMapperState()
    );
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].uuid).toBe('msg-c-1');
    expect(r.messages[0].parts).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'text', text: 'world' }
    ]);
  });

  it('aliases exec_command to tool-Bash', () => {
    const r = mapCodexLine(
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          id: 'p-1',
          call_id: 'call-c1',
          name: 'exec_command',
          arguments: JSON.stringify({ command: 'ls' })
        }
      }),
      createMapperState()
    );
    expect(r.messages[0].parts[0]).toMatchObject({
      type: 'tool-Bash',
      toolCallId: 'call-c1',
      state: 'input-available'
    });
  });

  it('merges a function_call_output into the prior function_call by call_id', () => {
    const state = createMapperState();
    const callLine = JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'function_call',
        id: 'p-2',
        call_id: 'call-c2',
        name: 'exec_command',
        arguments: '{}'
      }
    });
    const r1 = mapCodexLine(callLine, state);
    expect(r1.messages[0].parts[0].state).toBe('input-available');

    const outLine = JSON.stringify({
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: 'call-c2', output: 'done' }
    });
    mapCodexLine(outLine, state);
    expect(r1.messages[0].parts[0]).toMatchObject({ state: 'output-available', output: 'done' });
  });

  it('emits file-change side-effects from patch_apply_end', () => {
    const r = mapCodexLine(
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'patch_apply_end',
          success: true,
          changes: {
            '/repo/a.ts': { kind: 'add' },
            '/repo/b.ts': { kind: 'update' },
            '/repo/c.ts': { kind: 'delete' }
          }
        }
      }),
      createMapperState()
    );
    expect(r.sideEffects).toEqual([
      { kind: 'file-change', path: '/repo/a.ts', action: 'create' },
      { kind: 'file-change', path: '/repo/b.ts', action: 'update' },
      { kind: 'file-change', path: '/repo/c.ts', action: 'delete' }
    ]);
  });

  it('aliases update_plan to tool-TodoWrite + tasks side-effect', () => {
    const r = mapCodexLine(
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          id: 'p-3',
          call_id: 'call-c3',
          name: 'update_plan',
          arguments: JSON.stringify({ plan: [{ step: 'do thing', status: 'pending' }] })
        }
      }),
      createMapperState()
    );
    expect(r.messages[0].parts[0].type).toBe('tool-TodoWrite');
    expect(r.sideEffects).toEqual([{ kind: 'tasks', tasks: [{ step: 'do thing', status: 'pending' }] }]);
  });

  it('skips informational payload types', () => {
    const state = createMapperState();
    for (const t of ['token_count', 'agent_message', 'user_message', 'task_started', 'task_complete']) {
      const r = mapCodexLine(JSON.stringify({ type: 'event_msg', payload: { type: t } }), state);
      expect(r.messages).toEqual([]);
      expect(r.sideEffects).toEqual([]);
    }
  });
});

// Regression suite for the "interrupted via churro-coder" bug: a tool_result that
// lands on a LATER record than its tool_use must surface a re-persist instruction
// (updatedMessages / orphanToolResults), because the owner row was already written
// to SQLite and the in-place mutation alone never reaches disk.
describe('jsonl-mapper / cross-record tool_result re-persistence', () => {
  function claudeToolUse(callId: string, name: string, input: unknown, uuid = 'a1'): string {
    return JSON.stringify({
      type: 'assistant',
      uuid,
      message: { role: 'assistant', content: [{ type: 'tool_use', id: callId, name, input }] }
    });
  }
  function claudeToolResult(callId: string, content: unknown, isError = false, uuid = 'u1'): string {
    return JSON.stringify({
      type: 'user',
      uuid,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: callId, content, is_error: isError }] }
    });
  }

  it('emits updatedMessages referencing the owner row + the same parts array', () => {
    const state = createMapperState();
    const resultContent = [{ type: 'text', text: 'Task `t1` is now in_progress.' }];
    const r1 = mapClaudeLine(
      claudeToolUse('call-1', 'mcp__churro-coder__update_task_status', { id: 't1', status: 'in_progress' }),
      state
    );
    expect(r1.updatedMessages).toBeUndefined();

    const r2 = mapClaudeLine(claudeToolResult('call-1', resultContent), state);
    expect(r2.messages).toHaveLength(0);
    expect(r2.updatedMessages).toHaveLength(1);
    expect(r2.updatedMessages![0].uuid).toBe('a1');
    expect(r2.updatedMessages![0].parts[0]).toMatchObject({ state: 'output-available', output: resultContent });
    // Must be the EXACT array the owner message was emitted with, so re-persisting
    // it serializes the merged output.
    expect(r2.updatedMessages![0].parts).toBe(r1.messages[0].parts);
  });

  it('marks an errored tool_result as output-error', () => {
    const state = createMapperState();
    mapClaudeLine(claudeToolUse('call-2', 'mcp__churro-coder__write_plan', {}), state);
    const r = mapClaudeLine(claudeToolResult('call-2', 'boom', true), state);
    expect(r.updatedMessages![0].parts[0].state).toBe('output-error');
  });

  it('emits orphanToolResults when the tool_use is not pending (e.g. after a restart)', () => {
    const state = createMapperState();
    const r = mapClaudeLine(claudeToolResult('call-orphan', [{ type: 'text', text: 'done' }]), state);
    expect(r.messages).toHaveLength(0);
    expect(r.updatedMessages).toBeUndefined();
    expect(r.orphanToolResults).toHaveLength(1);
    expect(r.orphanToolResults![0]).toMatchObject({ toolCallId: 'call-orphan', state: 'output-available' });
    expect(r.orphanToolResults![0].output).toEqual([{ type: 'text', text: 'done' }]);
  });

  it('does NOT emit an update when tool_use and tool_result share a record', () => {
    // Same-record: the merge happens before the message is emitted, so the part is
    // persisted complete with no separate update needed.
    const state = createMapperState();
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'same-1',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'c-same', name: 'Bash', input: { command: 'ls' } },
          { type: 'tool_result', tool_use_id: 'c-same', content: 'ok' }
        ]
      }
    });
    const r = mapClaudeLine(line, state);
    expect(r.messages[0].parts[0]).toMatchObject({ state: 'output-available', output: 'ok' });
    expect(r.updatedMessages).toBeUndefined();
    expect(r.orphanToolResults).toBeUndefined();
  });

  it('Codex: function_call_output emits updatedMessages for its function_call', () => {
    const state = createMapperState();
    const r1 = mapCodexLine(
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', id: 'fc1', call_id: 'call-x', name: 'exec_command', arguments: '{}' }
      }),
      state
    );
    expect(r1.updatedMessages).toBeUndefined();
    const r2 = mapCodexLine(
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call_output', call_id: 'call-x', output: 'done' }
      }),
      state
    );
    expect(r2.messages).toHaveLength(0);
    expect(r2.updatedMessages).toHaveLength(1);
    expect(r2.updatedMessages![0].uuid).toBe('fc1');
    expect(r2.updatedMessages![0].parts[0]).toMatchObject({ state: 'output-available', output: 'done' });
  });

  it('Codex: orphan function_call_output emits orphanToolResults', () => {
    const r = mapCodexLine(
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call_output', call_id: 'call-gone', output: 'late' }
      }),
      createMapperState()
    );
    expect(r.orphanToolResults).toHaveLength(1);
    expect(r.orphanToolResults![0]).toMatchObject({
      toolCallId: 'call-gone',
      output: 'late',
      state: 'output-available'
    });
  });
});
