import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpRoot: string;

// electron.app.getPath → temp dir (ingest-state-store + plan-store write here).
vi.mock('electron', () => ({ app: { getPath: () => tmpRoot } }));
vi.mock('../db', () => ({ getDatabase: () => ({}) }));

// A small stateful fake of the messages table so the tool-result persistence
// tests can assert the FINAL stored parts. `appendIngestedMessage` deep-copies
// (mirroring JSON serialization in SQLite) so an in-place mutation by the mapper
// does NOT leak into a stored row — only an explicit update lands it. This makes
// "is the output actually persisted?" a real assertion, not a reference alias.
const mdb = vi.hoisted(() => {
  const rows = new Map<string, Array<{ idx: number; id: string; role: string; parts: any[] }>>();
  const clone = (x: unknown) => JSON.parse(JSON.stringify(x));
  const list = (sub: string) => {
    let a = rows.get(sub);
    if (!a) {
      a = [];
      rows.set(sub, a);
    }
    return a;
  };
  return { rows, clone, list };
});

vi.mock('../db/messages-table', () => ({
  appendIngestedMessage: (_db: unknown, sub: string, idx: number, msg: any) => {
    const a = mdb.list(sub);
    if (a.some((r) => r.id === msg.id)) return null;
    a.push({ idx, id: msg.id, role: msg.role, parts: mdb.clone(msg.parts) });
    return idx;
  },
  nextMessageIdx: (_db: unknown, sub: string) => {
    const a = mdb.list(sub);
    return a.length === 0 ? 0 : Math.max(...a.map((r) => r.idx)) + 1;
  },
  refreshSubChatCountersAfterIngest: () => {},
  updateIngestedMessageParts: (_db: unknown, sub: string, id: string, parts: any[]) => {
    const r = mdb.list(sub).find((x) => x.id === id);
    if (!r) return false;
    r.parts = mdb.clone(parts);
    return true;
  },
  updateMessagePartByToolCallId: (_db: unknown, sub: string, toolCallId: string, output: unknown, state: string) => {
    const a = mdb.list(sub);
    for (let i = a.length - 1; i >= 0; i--) {
      const p = a[i].parts.findIndex((x: any) => x && x.toolCallId === toolCallId);
      if (p !== -1) {
        a[i].parts[p] = { ...a[i].parts[p], output, state };
        return true;
      }
    }
    return false;
  },
  hasOrphanedToolPart: (_db: unknown, sub: string) =>
    mdb.list(sub).some((r) => r.parts.some((p: any) => p && p.state === 'input-available')),
  deleteMessagesForSubChat: (_db: unknown, sub: string) => {
    mdb.rows.delete(sub);
  }
}));

import { CliSessionIngester } from './ingester';
import { hasPlan, readCurrentPlan, writeCurrentPlan } from '../plans/plan-store';
import { hasReview, readCurrentReview, writeCurrentReview } from '../reviews/review-store';

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'cli-ingester-test-'));
  mdb.rows.clear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmpRoot, { recursive: true, force: true });
});

/** One Claude JSONL line: an assistant turn that calls our MCP write_plan tool
 *  (its `markdown` input is present even when the tool itself errored). */
function claudeWritePlanLine(markdown: string): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: 'u-plan-1',
    timestamp: '2026-06-08T12:00:00Z',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'call-plan',
          name: 'mcp__churro-coder__write_plan',
          input: { markdown, title: 'Recovered Plan' }
        }
      ]
    }
  });
}

describe('CliSessionIngester.reingestFull — plan recovery (fill-gaps)', () => {
  it('recovers the plan from the JSONL and has it on disk before resolving', async () => {
    const subChatId = 'sub-ingest-1';
    const sessionFile = join(tmpRoot, 'session.jsonl');
    const markdown = '# Recovered Plan\n\nrebuilt from the transcript';
    await writeFile(sessionFile, claudeWritePlanLine(markdown) + '\n', 'utf8');

    expect(await hasPlan(subChatId)).toBe(false);

    const ing = new CliSessionIngester(subChatId, 'claude-cli', sessionFile);
    const result = await ing.reingestFull();

    // Deterministic: the plan side-effect is awaited before reingestFull
    // resolves — regression guard for the readline-async race where 'close'
    // could resolve while the plan write was still pending (count 0, file
    // absent at the moment Refresh re-read getCurrentPlan).
    expect(result.sideEffectsApplied).toBeGreaterThanOrEqual(1);
    expect(await hasPlan(subChatId)).toBe(true);
    expect((await readCurrentPlan(subChatId))?.content).toBe(markdown);
  });

  it('does not overwrite an existing plan (MCP wins on conflict)', async () => {
    const subChatId = 'sub-ingest-2';
    const sessionFile = join(tmpRoot, 'session2.jsonl');
    await writeFile(sessionFile, claudeWritePlanLine('# From JSONL\nbody') + '\n', 'utf8');

    // Pre-seed a plan as if the MCP server had already persisted one.
    await writeCurrentPlan({
      subChatId,
      content: '# Authoritative\nMCP wrote this',
      source: 'mcp',
      title: 'Authoritative'
    });

    const ing = new CliSessionIngester(subChatId, 'claude-cli', sessionFile);
    await ing.reingestFull();

    expect((await readCurrentPlan(subChatId))?.content).toBe('# Authoritative\nMCP wrote this');
  });
});

/** A 2-line Claude JSONL transcript matching a real `/code-review` invocation:
 *  the user turn is the bare command text, its child is the `system`/
 *  `local_command` record carrying the review findings as stdout. */
function claudeCodeReviewLines(stdout: string): string {
  return (
    [
      JSON.stringify({
        type: 'user',
        uuid: 'cmd-1',
        message: { role: 'user', content: '/code-review high' }
      }),
      JSON.stringify({
        type: 'system',
        subtype: 'local_command',
        parentUuid: 'cmd-1',
        uuid: 'result-1',
        content: `<local-command-stdout>${stdout}</local-command-stdout>`
      })
    ].join('\n') + '\n'
  );
}

describe('CliSessionIngester.reingestFull — review recovery (fill-gaps)', () => {
  it('recovers the review from /code-review local-command stdout', async () => {
    const subChatId = 'sub-ingest-review-1';
    const sessionFile = join(tmpRoot, 'review-session.jsonl');
    await writeFile(sessionFile, claudeCodeReviewLines('math.js:3 — returns a - b instead of a + b'), 'utf8');

    expect(await hasReview(subChatId)).toBe(false);

    const ing = new CliSessionIngester(subChatId, 'claude-cli', sessionFile);
    const result = await ing.reingestFull();

    expect(result.sideEffectsApplied).toBeGreaterThanOrEqual(1);
    expect(await hasReview(subChatId)).toBe(true);
    expect((await readCurrentReview(subChatId))?.content).toBe('math.js:3 — returns a - b instead of a + b');
  });

  it('does not overwrite an existing review (explicit write_review wins on conflict)', async () => {
    const subChatId = 'sub-ingest-review-2';
    const sessionFile = join(tmpRoot, 'review-session2.jsonl');
    await writeFile(sessionFile, claudeCodeReviewLines('auto-captured findings'), 'utf8');

    await writeCurrentReview({
      subChatId,
      content: '# Authoritative\nMCP wrote this review',
      source: 'mcp',
      title: 'Authoritative'
    });

    const ing = new CliSessionIngester(subChatId, 'claude-cli', sessionFile);
    await ing.reingestFull();

    expect((await readCurrentReview(subChatId))?.content).toBe('# Authoritative\nMCP wrote this review');
  });
});

/** A 3-line Codex transcript in chronological order: an assistant TEXT turn,
 *  then a shell tool call, then its output. The pre-fix mapper dropped the
 *  id-less text message and persisted only the tool call. */
function codexTextThenTool(): string {
  return (
    [
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-06-09T20:10:50Z',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Voy a revisar.' }] }
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-06-09T20:10:51Z',
        payload: { type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"command":"ls"}' }
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-06-09T20:10:52Z',
        payload: { type: 'function_call_output', call_id: 'c1', output: 'a\nb' }
      })
    ].join('\n') + '\n'
  );
}

describe('CliSessionIngester.rebuildFromScratch — Codex heal', () => {
  it('wipes gutted rows and re-ingests the transcript in chronological order', async () => {
    const subChatId = 'sub-codex-heal';
    const sessionFile = join(tmpRoot, 'rollout.jsonl');
    await writeFile(sessionFile, codexTextThenTool(), 'utf8');

    // Simulate the pre-fix gutted state: only a stale tool row, no assistant text.
    mdb.list(subChatId).push({
      idx: 0,
      id: 'stale-tool',
      role: 'assistant',
      parts: [{ type: 'tool-Bash', toolCallId: 'old', state: 'input-available' }]
    });

    const ing = new CliSessionIngester(subChatId, 'codex-cli', sessionFile);
    await ing.rebuildFromScratch();

    const rows = mdb.list(subChatId);
    // Stale row gone; rebuilt in transcript order: text (idx 0) BEFORE tool (idx 1).
    expect(rows.some((r) => r.id === 'stale-tool')).toBe(false);
    expect(rows).toHaveLength(2);
    const byIdx = [...rows].sort((a, b) => a.idx - b.idx);
    expect(byIdx[0].parts[0]).toMatchObject({ type: 'text', text: 'Voy a revisar.' });
    expect(byIdx[1].parts[0]).toMatchObject({ type: 'tool-Bash', state: 'output-available', output: 'a\nb' });
  });
});

/** Two Claude JSONL lines: an assistant turn calling our MCP update_task_status
 *  tool, followed by the user turn carrying its tool_result on a SEPARATE record
 *  (the shape that used to render as "interrupted via churro-coder"). */
function claudeToolUseThenResult(subChatId: string): string {
  return (
    [
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-06-08T12:00:00Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'mcp__churro-coder__update_task_status',
              input: { subChatId, id: 't1', status: 'in_progress' }
            }
          ]
        }
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-06-08T12:00:01Z',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call-1',
              content: [{ type: 'text', text: 'Task `t1` is now in_progress.' }]
            }
          ]
        }
      })
    ].join('\n') + '\n'
  );
}

describe('CliSessionIngester — cross-record tool_result persistence', () => {
  it('lands the tool_result output on the persisted owner row during live ingest', async () => {
    const subChatId = 'sub-tr-live';
    const sessionFile = join(tmpRoot, 'tr-live.jsonl');
    await writeFile(sessionFile, claudeToolUseThenResult(subChatId), 'utf8');

    const ing = new CliSessionIngester(subChatId, 'claude-cli', sessionFile);
    await ing.ingestPending();

    const owner = mdb.rows.get(subChatId)?.find((r) => r.id === 'a1');
    expect(owner).toBeDefined();
    // The bug: this part used to stay 'input-available' (→ "interrupted").
    expect(owner!.parts[0].state).toBe('output-available');
    expect(owner!.parts[0].output).toEqual([{ type: 'text', text: 'Task `t1` is now in_progress.' }]);
  });

  it('persists the rich subagent toolUseResult on the owner row', async () => {
    const subChatId = 'sub-tr-subagent';
    const sessionFile = join(tmpRoot, 'tr-subagent.jsonl');
    const taskResult = {
      status: 'completed',
      agentType: 'Explore',
      totalTokens: 67917,
      totalToolUseCount: 31,
      toolStats: { readCount: 18, bashCount: 13 },
      content: [{ type: 'text', text: 'Investigation summary…' }]
    };
    const lines =
      [
        JSON.stringify({
          type: 'assistant',
          uuid: 'task-a',
          timestamp: '2026-06-08T12:00:00Z',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'task-1',
                name: 'Agent',
                input: { description: 'Find X', subagent_type: 'Explore' }
              }
            ]
          }
        }),
        JSON.stringify({
          type: 'user',
          uuid: 'task-u',
          timestamp: '2026-06-08T12:00:05Z',
          toolUseResult: taskResult,
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'task-1', content: taskResult.content }]
          }
        })
      ].join('\n') + '\n';
    await writeFile(sessionFile, lines, 'utf8');

    const ing = new CliSessionIngester(subChatId, 'claude-cli', sessionFile);
    await ing.ingestPending();

    const owner = mdb.rows.get(subChatId)?.find((r) => r.id === 'task-a');
    expect(owner!.parts[0]).toMatchObject({ type: 'tool-Agent', state: 'output-available' });
    // The whole structured object reaches SQLite — totals/toolStats the renderer needs.
    expect(owner!.parts[0].output).toEqual(taskResult);
  });

  it('heals a pre-existing orphaned input-available row on repair', async () => {
    const subChatId = 'sub-tr-repair';
    const sessionFile = join(tmpRoot, 'tr-repair.jsonl');
    await writeFile(sessionFile, claudeToolUseThenResult(subChatId), 'utf8');
    // Simulate a prior app session that persisted only the tool_use (the result
    // was dropped before this fix existed).
    mdb.rows.set(subChatId, [
      {
        idx: 0,
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-mcp__churro-coder__update_task_status',
            toolCallId: 'call-1',
            input: {},
            state: 'input-available'
          }
        ]
      }
    ]);

    const ing = new CliSessionIngester(subChatId, 'claude-cli', sessionFile);
    const healed = await ing.repairPersistedToolResults();

    expect(healed).toBe(1);
    expect(mdb.rows.get(subChatId)![0].parts[0].state).toBe('output-available');
  });

  it('does not loop-walk a genuinely interrupted (result-less) call', async () => {
    const subChatId = 'sub-tr-genuine';
    const sessionFile = join(tmpRoot, 'tr-genuine.jsonl');
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call-1', name: 'mcp__churro-coder__update_task_status', input: {} }]
      }
    });
    await writeFile(sessionFile, line + '\n', 'utf8');
    mdb.rows.set(subChatId, [
      {
        idx: 0,
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'tool-x', toolCallId: 'call-1', state: 'input-available' }]
      }
    ]);

    const ing = new CliSessionIngester(subChatId, 'claude-cli', sessionFile);
    const first = await ing.repairPersistedToolResults();
    const second = await ing.repairPersistedToolResults();

    expect(first).toBe(0); // no result on disk to apply
    expect(second).toBe(0); // once-per-instance guard prevents a second walk
    expect(mdb.rows.get(subChatId)![0].parts[0].state).toBe('input-available'); // stays flagged
  });
});
