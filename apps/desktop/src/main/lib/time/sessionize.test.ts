import { describe, it, expect } from 'vitest';
import { sessionizeTimestamps, splitByDay } from './sessionize';
import { localDateKey } from '../date-keys';

const MIN = 60_000;

describe('sessionizeTimestamps', () => {
  it('returns no sessions for empty input', () => {
    expect(sessionizeTimestamps([])).toEqual([]);
  });

  it('keeps sub-threshold gaps in one continuous session (billable engagement)', () => {
    const t0 = Date.parse('2026-06-10T10:00:00Z');
    const s = sessionizeTimestamps([t0, t0 + 2 * MIN, t0 + 6 * MIN], 5 * MIN);
    expect(s).toHaveLength(1);
    expect(s[0].end - s[0].start).toBe(6 * MIN);
  });

  it('splits when an idle gap exceeds the threshold', () => {
    const t0 = Date.parse('2026-06-10T10:00:00Z');
    const s = sessionizeTimestamps([t0, t0 + 1 * MIN, t0 + 30 * MIN, t0 + 31 * MIN], 5 * MIN);
    expect(s).toHaveLength(2);
    expect(s[0].end - s[0].start).toBe(1 * MIN);
    expect(s[1].end - s[1].start).toBe(1 * MIN);
  });

  it('sorts non-monotonic timestamps so spans are never negative', () => {
    const t0 = Date.parse('2026-06-10T10:00:00Z');
    const s = sessionizeTimestamps([t0 + 2 * MIN, t0, t0 + 1 * MIN], 5 * MIN);
    expect(s).toHaveLength(1);
    expect(s[0].start).toBe(t0);
    expect(s[0].end).toBe(t0 + 2 * MIN);
  });
});

describe('splitByDay', () => {
  it('returns empty for zero or negative spans', () => {
    expect(splitByDay(1000, 1000)).toEqual([]);
    expect(splitByDay(2000, 1000)).toEqual([]);
  });

  it('keeps a same-day span in one bucket', () => {
    const start = new Date(2026, 5, 10, 9, 0, 0).getTime();
    const end = new Date(2026, 5, 10, 10, 30, 0).getTime();
    const slices = splitByDay(start, end);
    expect(slices).toHaveLength(1);
    expect(slices[0].dateKey).toBe('2026-06-10');
    expect(slices[0].ms).toBe(90 * MIN);
  });

  it('splits an overnight span at local midnight', () => {
    const start = new Date(2026, 5, 10, 23, 30, 0).getTime();
    const end = new Date(2026, 5, 11, 0, 30, 0).getTime();
    const slices = splitByDay(start, end);
    expect(slices.map((s) => s.dateKey)).toEqual(['2026-06-10', '2026-06-11']);
    expect(slices[0].ms).toBe(30 * MIN);
    expect(slices[1].ms).toBe(30 * MIN);
  });
});

describe('localDateKey', () => {
  it('formats local YYYY-MM-DD', () => {
    const ts = new Date(2026, 0, 5, 12, 0, 0).getTime();
    expect(localDateKey(ts)).toBe('2026-01-05');
  });
});
