import { describe, expect, it } from 'vitest';
import { summarizeToolStats } from './agent-format-utils';

describe('summarizeToolStats', () => {
  it('joins non-zero buckets with a middot, omitting zero buckets', () => {
    expect(summarizeToolStats({ readCount: 18, searchCount: 0, bashCount: 13, editFileCount: 0 })).toBe(
      '18 reads · 13 commands'
    );
  });

  it('singularizes counts of one (order: reads · searches · commands)', () => {
    expect(summarizeToolStats({ readCount: 1, bashCount: 1, searchCount: 1 })).toBe('1 read · 1 search · 1 command');
  });

  it('appends line deltas for edits when present', () => {
    expect(summarizeToolStats({ editFileCount: 2, linesAdded: 40, linesRemoved: 5 })).toBe('2 edits (+40 -5)');
  });

  it('omits the line delta when no lines changed', () => {
    expect(summarizeToolStats({ editFileCount: 1, linesAdded: 0, linesRemoved: 0 })).toBe('1 edit');
  });

  it('returns empty string for all-zero, null, or undefined stats', () => {
    expect(summarizeToolStats({ readCount: 0, bashCount: 0, editFileCount: 0, searchCount: 0 })).toBe('');
    expect(summarizeToolStats(null)).toBe('');
    expect(summarizeToolStats(undefined)).toBe('');
  });

  it('counts other tools', () => {
    expect(summarizeToolStats({ otherToolCount: 3 })).toBe('3 other');
  });
});
