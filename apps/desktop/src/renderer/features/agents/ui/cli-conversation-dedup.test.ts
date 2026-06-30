import { describe, expect, it } from 'vitest';
import { firstTextOfParts, isAdjacentUserDup, type PrevRendered } from './cli-conversation-dedup';

describe('firstTextOfParts', () => {
  it('returns the trimmed text of the first text part', () => {
    expect(firstTextOfParts([{ type: 'text', text: '  hello world  ' }])).toBe('hello world');
  });

  it('returns null when there is no text part', () => {
    expect(firstTextOfParts([{ type: 'tool-Bash', input: {} }])).toBeNull();
  });

  it('returns null for whitespace-only text', () => {
    expect(firstTextOfParts([{ type: 'text', text: '   \n   ' }])).toBeNull();
  });

  it('skips non-text parts and picks the first text it finds', () => {
    expect(
      firstTextOfParts([
        { type: 'data-image', data: {} },
        { type: 'text', text: 'the prompt' }
      ])
    ).toBe('the prompt');
  });

  it('returns null on an empty array', () => {
    expect(firstTextOfParts([])).toBeNull();
  });
});

const userPrev = (text: string): PrevRendered => ({ role: 'user', text });
const assistantPrev = (text: string | null): PrevRendered => ({ role: 'assistant', text });

describe('isAdjacentUserDup', () => {
  it('drops a user message whose text matches the immediately preceding *user* row', () => {
    const result = isAdjacentUserDup(
      { role: 'user', parts: [{ type: 'text', text: 'cambia el fondo a fuscia' }] },
      userPrev('cambia el fondo a fuscia')
    );
    expect(result.dropped).toBe(true);
  });

  it('does not drop when the previous user text differs', () => {
    const result = isAdjacentUserDup(
      { role: 'user', parts: [{ type: 'text', text: 'second prompt' }] },
      userPrev('first prompt')
    );
    expect(result.dropped).toBe(false);
  });

  it('treats trimmed-equal texts as duplicates', () => {
    const result = isAdjacentUserDup(
      { role: 'user', parts: [{ type: 'text', text: '  hi there\n' }] },
      userPrev('hi there')
    );
    expect(result.dropped).toBe(true);
  });

  it('does NOT drop when an assistant row intervenes (the "yes … yes" case)', () => {
    // This is the bug fix: identical text is only a duplicate when the prior
    // *rendered* row was a user — an assistant turn in between breaks adjacency.
    const result = isAdjacentUserDup({ role: 'user', parts: [{ type: 'text', text: 'yes' }] }, assistantPrev('yes'));
    expect(result.dropped).toBe(false);
  });

  it('does not drop assistant messages', () => {
    const result = isAdjacentUserDup(
      { role: 'assistant', parts: [{ type: 'text', text: 'cambia el fondo a fuscia' }] },
      userPrev('cambia el fondo a fuscia')
    );
    expect(result.dropped).toBe(false);
  });

  it('does not drop a non-text user message against a prior user', () => {
    const result = isAdjacentUserDup(
      { role: 'user', parts: [{ type: 'data-image', data: {} }] },
      userPrev('prior text')
    );
    expect(result.dropped).toBe(false);
  });

  it('initial prev=null: a user message is kept', () => {
    const result = isAdjacentUserDup({ role: 'user', parts: [{ type: 'text', text: 'first user message' }] }, null);
    expect(result.dropped).toBe(false);
  });
});

// Integration-style: walks a row sequence the same way cli-conversation-pane's
// useMemo does, tracking the previous *rendered* row.
describe('isAdjacentUserDup — sequence walk', () => {
  type Msg = { role: 'user' | 'assistant'; parts: unknown[] };

  function walk(rows: Msg[]): Msg[] {
    const out: Msg[] = [];
    let prev: PrevRendered | null = null;
    for (const r of rows) {
      if (isAdjacentUserDup(r, prev).dropped) continue;
      out.push(r);
      prev = { role: r.role, text: firstTextOfParts(r.parts) };
    }
    return out;
  }

  it('collapses optimistic + JSONL-ingested adjacent duplicate', () => {
    const rows: Msg[] = [
      { role: 'user', parts: [{ type: 'text', text: 'cambia el fondo a fuscia' }] }, // idx=0 optimistic
      // idx=1-3 (envelope-only) were already dropped by the strip pass in the pane
      { role: 'user', parts: [{ type: 'text', text: 'cambia el fondo a fuscia' }] }, // idx=4 ingested, stripped clean
      { role: 'assistant', parts: [{ type: 'tool-Bash', input: { command: 'ls' } }] }
    ];
    const out = walk(rows);
    expect(out).toHaveLength(2);
    expect(out[0].role).toBe('user');
    expect(out[1].role).toBe('assistant');
  });

  it('keeps a legitimate second user turn with different text', () => {
    const rows: Msg[] = [
      { role: 'user', parts: [{ type: 'text', text: 'first prompt' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'response' }] },
      { role: 'user', parts: [{ type: 'text', text: 'second prompt' }] }
    ];
    expect(walk(rows)).toHaveLength(3);
  });

  it('keeps a repeated short input separated by an assistant turn ("yes" … "yes")', () => {
    const rows: Msg[] = [
      { role: 'user', parts: [{ type: 'text', text: 'yes' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'doing it' }] },
      { role: 'user', parts: [{ type: 'text', text: 'yes' }] }
    ];
    expect(walk(rows)).toHaveLength(3);
  });
});
