import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpRoot: string;
vi.mock('electron', () => ({ app: { getPath: () => tmpRoot } }));

import { emptyIngestState, mutateIngestState, readIngestState, writeIngestState } from './ingest-state-store';

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'cli-ingest-state-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('ingest-state-store', () => {
  it('returns null when no state file exists', async () => {
    const s = await readIngestState('sub-missing');
    expect(s).toBeNull();
  });

  it('round-trips a state through write then read', async () => {
    const original = emptyIngestState('/tmp/session.jsonl', 7);
    original.byteOffset = 1234;
    original.messageUuids.push('a', 'b', 'c');

    await writeIngestState('sub-1', original);
    const loaded = await readIngestState('sub-1');
    expect(loaded).toEqual(original);
  });

  it('mutate creates fresh state when none exists', async () => {
    const next = await mutateIngestState(
      'sub-2',
      (s) => ({ ...s, byteOffset: 99, nextIdx: 3 }),
      () => emptyIngestState('/tmp/x.jsonl')
    );
    expect(next.byteOffset).toBe(99);
    expect(next.nextIdx).toBe(3);
    expect(next.sessionFile).toBe('/tmp/x.jsonl');
  });

  it('trims messageUuids history to the most recent N', async () => {
    const big = emptyIngestState('/tmp/big.jsonl');
    for (let i = 0; i < 1500; i++) big.messageUuids.push(`u-${i}`);
    await writeIngestState('sub-3', big);
    const loaded = await readIngestState('sub-3');
    expect(loaded!.messageUuids.length).toBe(1000);
    // Most recent kept (suffix slice).
    expect(loaded!.messageUuids[0]).toBe('u-500');
    expect(loaded!.messageUuids[999]).toBe('u-1499');
  });
});
