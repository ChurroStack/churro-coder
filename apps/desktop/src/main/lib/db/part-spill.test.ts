import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpRoot: string;
vi.mock('electron', () => ({ app: { getPath: () => tmpRoot } }));

import { writePartIfLargeSync, SPILL_THRESHOLD } from './part-spill';

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'part-spill-test-'));
});
afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('writePartIfLargeSync', () => {
  it('returns small parts unchanged (no mutation, no spill)', () => {
    const part = { type: 'tool-Write', toolCallId: 'call-1', state: 'input-available', input: { x: 1 } };
    const out = writePartIfLargeSync('sub', 'msg', 0, part);
    expect(out).toBe(part); // same reference — not mutated
  });

  it('preserves `state` in the spill stub so hasOrphanedToolPart can see a spilled orphan', () => {
    const big = 'x'.repeat(SPILL_THRESHOLD + 10);
    const part = { type: 'tool-Write', toolCallId: 'call-1', state: 'input-available', input: { content: big } };
    const stub = writePartIfLargeSync('sub', 'msg', 0, part) as Record<string, unknown>;

    expect(stub).not.toBe(part);
    expect(stub.type).toBe('tool-Write');
    expect(stub.state).toBe('input-available');
    expect(stub._spill).toBeDefined();
    // The gate scans serialized row JSON for this exact substring.
    expect(JSON.stringify(stub)).toContain('"state":"input-available"');
    // toolCallId is intentionally NOT carried into the stub (keeps spilled parts
    // out of the by-toolCallId patch path; the repair walk heals them whole).
    expect(stub.toolCallId).toBeUndefined();
    // The original part object is never mutated.
    expect((part as Record<string, unknown>).input).toBeDefined();
  });

  it('omits `state` when the spilled part has none', () => {
    const big = 'y'.repeat(SPILL_THRESHOLD + 10);
    const part = { type: 'text', text: big };
    const stub = writePartIfLargeSync('sub', 'msg', 1, part) as Record<string, unknown>;
    expect('state' in stub).toBe(false);
    expect(stub.type).toBe('text');
  });
});
