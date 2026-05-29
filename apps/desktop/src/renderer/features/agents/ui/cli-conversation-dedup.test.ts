import { describe, expect, it } from 'vitest';
import { firstTextOfParts, isAdjacentUserDup } from './cli-conversation-dedup';

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

describe('isAdjacentUserDup', () => {
  it('drops a user message whose text matches the immediately preceding user', () => {
    const result = isAdjacentUserDup(
      { role: 'user', parts: [{ type: 'text', text: 'cambia el fondo a fuscia' }] },
      'cambia el fondo a fuscia'
    );
    expect(result.dropped).toBe(true);
    expect(result.userText).toBe('cambia el fondo a fuscia');
  });

  it('does not drop when the user text differs', () => {
    const result = isAdjacentUserDup(
      { role: 'user', parts: [{ type: 'text', text: 'second prompt' }] },
      'first prompt'
    );
    expect(result.dropped).toBe(false);
    expect(result.userText).toBe('second prompt');
  });

  it('treats trimmed-equal texts as duplicates', () => {
    // The pane runs envelope strip + render-time trim before reaching here,
    // so by the time isAdjacentUserDup sees a payload, leading/trailing
    // whitespace has been stripped — but the helper itself also trims.
    const result = isAdjacentUserDup({ role: 'user', parts: [{ type: 'text', text: '  hi there\n' }] }, 'hi there');
    expect(result.dropped).toBe(true);
  });

  it('does not drop assistant messages even when they share text with the prior user', () => {
    const result = isAdjacentUserDup(
      { role: 'assistant', parts: [{ type: 'text', text: 'cambia el fondo a fuscia' }] },
      'cambia el fondo a fuscia'
    );
    expect(result.dropped).toBe(false);
    expect(result.userText).toBe('cambia el fondo a fuscia'); // unchanged — preserves the last-user marker across an assistant message
  });

  it('does not reset the last-user marker on a non-text user message', () => {
    // First-text returns null → don't update lastUserText, don't dedup against a
    // non-comparable payload.
    const result = isAdjacentUserDup({ role: 'user', parts: [{ type: 'data-image', data: {} }] }, 'prior text');
    expect(result.dropped).toBe(false);
    expect(result.userText).toBeNull();
  });

  it('initial last=null: a user message renders and becomes the new last text', () => {
    const result = isAdjacentUserDup({ role: 'user', parts: [{ type: 'text', text: 'first user message' }] }, null);
    expect(result.dropped).toBe(false);
    expect(result.userText).toBe('first user message');
  });
});

// Integration-style: walks a row sequence the same way cli-conversation-pane's
// useMemo does, asserting that an optimistic-row + JSONL-ingested duplicate
// collapses into a single rendered user message.
describe('isAdjacentUserDup — sequence walk', () => {
  it('collapses optimistic + JSONL-ingested duplicate', () => {
    type Msg = { role: 'user' | 'assistant'; parts: unknown[] };
    const rows: Msg[] = [
      { role: 'user', parts: [{ type: 'text', text: 'cambia el fondo a fuscia' }] }, // idx=0 optimistic
      // idx=1-3 (envelope-only) were already dropped by the strip pass in the pane
      { role: 'user', parts: [{ type: 'text', text: 'cambia el fondo a fuscia' }] }, // idx=4 ingested, stripped clean
      { role: 'assistant', parts: [{ type: 'tool-Bash', input: { command: 'ls' } }] }
    ];

    const out: Msg[] = [];
    let last: string | null = null;
    for (const r of rows) {
      const d = isAdjacentUserDup(r, last);
      if (d.dropped) continue;
      last = d.userText;
      out.push(r);
    }

    expect(out).toHaveLength(2);
    expect(out[0].role).toBe('user');
    expect(out[1].role).toBe('assistant');
  });

  it('keeps a legitimate second user turn with different text', () => {
    type Msg = { role: 'user' | 'assistant'; parts: unknown[] };
    const rows: Msg[] = [
      { role: 'user', parts: [{ type: 'text', text: 'first prompt' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'response' }] },
      { role: 'user', parts: [{ type: 'text', text: 'second prompt' }] }
    ];

    const out: Msg[] = [];
    let last: string | null = null;
    for (const r of rows) {
      const d = isAdjacentUserDup(r, last);
      if (d.dropped) continue;
      last = d.userText;
      out.push(r);
    }

    expect(out).toHaveLength(3);
  });
});
