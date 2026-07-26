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

  describe('native /code-review (local command — verified against real transcripts)', () => {
    it('emits a review side-effect + assistant text part from local_command stdout', () => {
      const state = createMapperState();
      // The real command turn: role user, plain-string content "/code-review high".
      mapClaudeLine(
        JSON.stringify({
          type: 'user',
          uuid: 'cmd-uuid-1',
          parentUuid: 'caveat-uuid-1',
          message: { role: 'user', content: '/code-review high' }
        }),
        state
      );
      // Its child: the local_command system record carrying the stdout.
      const r = mapClaudeLine(
        JSON.stringify({
          type: 'system',
          subtype: 'local_command',
          parentUuid: 'cmd-uuid-1',
          uuid: 'result-uuid-1',
          content: '<local-command-stdout>math.js:3 — bug found here</local-command-stdout>'
        }),
        state
      );
      expect(r.sideEffects).toEqual([{ kind: 'review', markdown: 'math.js:3 — bug found here', title: 'Code Review' }]);
      expect(r.messages).toEqual([
        {
          uuid: 'result-uuid-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'math.js:3 — bug found here' }],
          createdAt: expect.any(Number)
        }
      ]);
    });

    it('ignores local_command output from unrelated commands (e.g. /usage)', () => {
      const state = createMapperState();
      mapClaudeLine(
        JSON.stringify({
          type: 'user',
          uuid: 'cmd-uuid-2',
          message: { role: 'user', content: '/usage' }
        }),
        state
      );
      const r = mapClaudeLine(
        JSON.stringify({
          type: 'system',
          subtype: 'local_command',
          parentUuid: 'cmd-uuid-2',
          uuid: 'result-uuid-2',
          content: '<local-command-stdout>some usage stats</local-command-stdout>'
        }),
        state
      );
      expect(r).toEqual({ messages: [], sideEffects: [] });
    });

    it('emits no review side-effect when /code-review forks to a background skill agent', () => {
      const state = createMapperState();
      mapClaudeLine(
        JSON.stringify({
          type: 'user',
          uuid: 'cmd-uuid-fork',
          message: { role: 'user', content: '/code-review' }
        }),
        state
      );
      // Real shape captured from a live transcript: the skill forked to a
      // background agent instead of resolving inline, so stdout is a launch
      // ack (no findings), plus a <forked-skill-launch> tag carrying the
      // detached agent's id.
      const r = mapClaudeLine(
        JSON.stringify({
          type: 'system',
          subtype: 'local_command',
          parentUuid: 'cmd-uuid-fork',
          uuid: 'result-uuid-fork',
          content:
            '<local-command-stdout>Running in the background as @code-review</local-command-stdout>\n' +
            '<forked-skill-launch>{"agentId":"abc123","skillName":"code-review","description":"/code-review"}</forked-skill-launch>'
        }),
        state
      );
      expect(r.sideEffects).toEqual([]);
      // Still surface the launch ack as an assistant message so the user sees
      // the review started, even though there's nothing to persist yet.
      expect(r.messages).toEqual([
        {
          uuid: 'result-uuid-fork',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Running in the background as @code-review' }],
          createdAt: expect.any(Number)
        }
      ]);
    });

    it('ignores a local_command record with no matching pending command', () => {
      const r = mapClaudeLine(
        JSON.stringify({
          type: 'system',
          subtype: 'local_command',
          parentUuid: 'no-such-uuid',
          uuid: 'orphan-uuid',
          content: '<local-command-stdout>orphaned output</local-command-stdout>'
        }),
        createMapperState()
      );
      expect(r).toEqual({ messages: [], sideEffects: [] });
    });
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

  describe('native /review (exited_review_mode — verified against a real rollout transcript)', () => {
    it('emits a review side-effect built from review_output.findings', () => {
      const r = mapCodexLine(
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'exited_review_mode',
            turn_id: 't-1',
            item_id: 'item-1',
            review_output: {
              findings: [
                {
                  title: '[P1] Keep review persistence working',
                  body: 'The dispatch change drops write_review calls.',
                  confidence_score: 0.98,
                  priority: 1,
                  code_location: {
                    absolute_file_path: '/repo/use-harness-send-dispatcher.ts',
                    line_range: { start: 181, end: 195 }
                  }
                }
              ],
              overall_correctness: 'patch is incorrect',
              overall_explanation: 'Review persistence regresses for CLI chats.',
              overall_confidence_score: 0.95
            }
          }
        }),
        createMapperState()
      );
      expect(r.messages).toEqual([]);
      expect(r.sideEffects).toHaveLength(1);
      const [se] = r.sideEffects;
      expect(se.kind).toBe('review');
      expect((se as { markdown: string }).markdown).toContain('Review persistence regresses for CLI chats.');
      expect((se as { markdown: string }).markdown).toContain('🔴 high');
      expect((se as { markdown: string }).markdown).toContain('use-harness-send-dispatcher.ts:181');
    });

    it('returns EMPTY when review_output is missing', () => {
      const r = mapCodexLine(
        JSON.stringify({ type: 'event_msg', payload: { type: 'exited_review_mode', turn_id: 't-2' } }),
        createMapperState()
      );
      expect(r).toEqual({ messages: [], sideEffects: [] });
    });
  });

  it('skips informational payload types', () => {
    const state = createMapperState();
    for (const t of ['token_count', 'agent_message', 'user_message', 'task_started', 'task_complete']) {
      const r = mapCodexLine(JSON.stringify({ type: 'event_msg', payload: { type: t } }), state);
      expect(r.messages).toEqual([]);
      expect(r.sideEffects).toEqual([]);
    }
  });

  // Regression: real Codex `message` / `reasoning` response_items carry NO `id`
  // field. The mapper used to `return EMPTY` on the missing id, dropping ALL
  // assistant/user text + reasoning and persisting only function_calls (which
  // fall back to call_id) — leaving the conversation pane blank.
  const idlessAssistant = (text: string) =>
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-06-09T20:10:50.735Z',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }
    });

  it('ingests an id-less assistant message with a synthesized stable id', () => {
    const r = mapCodexLine(idlessAssistant('Es un Buscaminas clásico.'), createMapperState());
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].parts).toEqual([{ type: 'text', text: 'Es un Buscaminas clásico.' }]);
    expect(r.messages[0].uuid).toMatch(/^codex-msg-[0-9a-f]{32}$/);
  });

  it('synthesizes the SAME id for the same record across re-walks (idempotent)', () => {
    const a = mapCodexLine(idlessAssistant('hola'), createMapperState());
    const b = mapCodexLine(idlessAssistant('hola'), createMapperState());
    expect(a.messages[0].uuid).toBe(b.messages[0].uuid);
    // Different content → different id.
    const c = mapCodexLine(idlessAssistant('adiós'), createMapperState());
    expect(c.messages[0].uuid).not.toBe(a.messages[0].uuid);
  });

  it('strips the environment_context wrapper from an id-less user message', () => {
    const r = mapCodexLine(
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-06-09T20:10:40Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: '<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>\nde que trata'
            }
          ]
        }
      }),
      createMapperState()
    );
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].role).toBe('user');
    expect(r.messages[0].parts).toEqual([{ type: 'text', text: 'de que trata' }]);
  });

  it('drops a user message that is ONLY an environment_context wrapper', () => {
    const r = mapCodexLine(
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>' }]
        }
      }),
      createMapperState()
    );
    expect(r.messages).toEqual([]);
  });

  it('maps reasoning text from summary[] (the real Codex shape)', () => {
    const r = mapCodexLine(
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-06-09T20:10:48Z',
        payload: {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'Clarifying the project plan' }],
          encrypted_content: 'gAAAA...'
        }
      }),
      createMapperState()
    );
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].parts).toEqual([{ type: 'reasoning', text: 'Clarifying the project plan' }]);
    expect(r.messages[0].uuid).toMatch(/^codex-reasoning-[0-9a-f]{32}$/);
  });

  it('drops reasoning with an empty summary and only encrypted_content', () => {
    const r = mapCodexLine(
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'reasoning', summary: [], encrypted_content: 'gAAAA...' }
      }),
      createMapperState()
    );
    expect(r.messages).toEqual([]);
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

// The native Claude JSONL attaches a record-level `toolUseResult` (sibling of
// `message`) to every tool_result — rich structured data the shared renderers
// read via `part.output.*` (subagent toolStats/tokens, Bash stdout/stderr, …).
// We prefer it over the bare tool_result content whenever it's an object,
// mirroring the builtin SDK path (`output = msg.tool_use_result || block.content`).
describe('jsonl-mapper / toolUseResult capture', () => {
  const taskResult = {
    status: 'completed',
    agentType: 'Explore',
    totalDurationMs: 106824,
    totalTokens: 67917,
    totalToolUseCount: 31,
    usage: { input_tokens: 0, output_tokens: 4464 },
    toolStats: { readCount: 18, searchCount: 0, bashCount: 13, editFileCount: 0, linesAdded: 0, linesRemoved: 0 },
    content: [{ type: 'text', text: 'Investigation summary…' }]
  };

  function agentToolUse(callId: string, uuid = 'a-task'): string {
    return JSON.stringify({
      type: 'assistant',
      uuid,
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: callId, name: 'Agent', input: { description: 'Find X', subagent_type: 'Explore' } }
        ]
      }
    });
  }
  function resultWithMeta(
    callId: string,
    content: unknown,
    toolUseResult: unknown,
    isError = false,
    uuid = 'u-res'
  ): string {
    return JSON.stringify({
      type: 'user',
      uuid,
      toolUseResult,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: callId, content, is_error: isError }] }
    });
  }

  it('captures the record-level toolUseResult as part.output for an Agent/Task result', () => {
    const state = createMapperState();
    const r1 = mapClaudeLine(agentToolUse('task-1'), state);
    const r2 = mapClaudeLine(resultWithMeta('task-1', taskResult.content, taskResult), state);
    expect(r2.updatedMessages).toHaveLength(1);
    expect(r1.messages[0].parts[0]).toMatchObject({ type: 'tool-Agent', state: 'output-available' });
    // The full rich object lands on output (not the bare content array).
    expect(r1.messages[0].parts[0].output).toEqual(taskResult);
  });

  it('captures toolUseResult for non-Task tools (Bash stdout/stderr), same-record', () => {
    const state = createMapperState();
    const bashMeta = { stdout: 'hello\n', stderr: '', interrupted: false, isImage: false };
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'a-bash',
      toolUseResult: bashMeta,
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'b-1', name: 'Bash', input: { command: 'echo hello' } },
          { type: 'tool_result', tool_use_id: 'b-1', content: 'hello\n' }
        ]
      }
    });
    const r = mapClaudeLine(line, state);
    expect(r.messages[0].parts[0]).toMatchObject({ type: 'tool-Bash', state: 'output-available' });
    expect(r.messages[0].parts[0].output).toEqual(bashMeta);
  });

  it('keeps the structured object on an errored subagent result (state output-error)', () => {
    const state = createMapperState();
    const errMeta = {
      status: 'error',
      agentType: 'Explore',
      content: [{ type: 'text', text: 'failed' }],
      toolStats: {}
    };
    mapClaudeLine(agentToolUse('e-1', 'a-err'), state);
    const r = mapClaudeLine(resultWithMeta('e-1', errMeta.content, errMeta, true), state);
    expect(r.updatedMessages![0].parts[0]).toMatchObject({ state: 'output-error' });
    expect(r.updatedMessages![0].parts[0].output).toEqual(errMeta);
  });

  it('carries the rich toolUseResult into orphanToolResults', () => {
    const r = mapClaudeLine(resultWithMeta('orphan-1', taskResult.content, taskResult), createMapperState());
    expect(r.orphanToolResults).toHaveLength(1);
    expect(r.orphanToolResults![0].output).toEqual(taskResult);
  });

  it('falls back to block.content when no toolUseResult is present', () => {
    const state = createMapperState();
    mapClaudeLine(
      JSON.stringify({
        type: 'assistant',
        uuid: 'a-nc',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'nc-1', name: 'Bash', input: { command: 'ls' } }]
        }
      }),
      state
    );
    const r = mapClaudeLine(
      JSON.stringify({
        type: 'user',
        uuid: 'u-nc',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'nc-1', content: 'README.md' }] }
      }),
      state
    );
    expect(r.updatedMessages![0].parts[0].output).toBe('README.md');
  });

  it('ignores a non-object (string) toolUseResult and uses block.content', () => {
    const state = createMapperState();
    mapClaudeLine(
      JSON.stringify({
        type: 'assistant',
        uuid: 'a-str',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 's-1', name: 'ExitPlanMode', input: {} }] }
      }),
      state
    );
    const r = mapClaudeLine(
      JSON.stringify({
        type: 'user',
        uuid: 'u-str',
        toolUseResult: 'Plan approved',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 's-1', content: [{ type: 'text', text: 'ok' }] }]
        }
      }),
      state
    );
    expect(r.updatedMessages![0].parts[0].output).toEqual([{ type: 'text', text: 'ok' }]);
  });
});
