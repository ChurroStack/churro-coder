import { describe, it, expect } from 'vitest';
import { periodRange } from './time-periods';

// A fixed local "now": Wed 2026-06-10 14:30 local.
const NOW = new Date(2026, 5, 10, 14, 30, 0).getTime();

describe('periodRange', () => {
  it('today starts at local midnight', () => {
    const r = periodRange('today', NOW);
    expect(r.startMs).toBe(new Date(2026, 5, 10, 0, 0, 0).getTime());
    expect(r.startKey).toBe('2026-06-10');
    expect(r.endKey).toBe('2026-06-10');
  });

  it('week starts on Monday of the current week', () => {
    const r = periodRange('week', NOW);
    // 2026-06-10 is a Wednesday → Monday is 2026-06-08.
    expect(r.startKey).toBe('2026-06-08');
  });

  it('thisMonth spans the calendar month to date', () => {
    const r = periodRange('thisMonth', NOW);
    expect(r.startKey).toBe('2026-06-01');
    expect(r.endKey).toBe('2026-06-10');
  });

  it('lastMonth is the full previous calendar month', () => {
    const r = periodRange('lastMonth', NOW);
    expect(r.startKey).toBe('2026-05-01');
    expect(r.endKey).toBe('2026-05-31'); // exclusive end at Jun 1 → last day May 31
    expect(r.endMs).toBe(new Date(2026, 5, 1).getTime());
  });

  it('lastMonth handles year boundary (Jan -> Dec)', () => {
    const jan = new Date(2026, 0, 15, 9, 0, 0).getTime();
    const r = periodRange('lastMonth', jan);
    expect(r.startKey).toBe('2025-12-01');
    expect(r.endKey).toBe('2025-12-31');
  });

  it('7d/30d start at local midnight (calendar days), so cost & runtime windows align', () => {
    const r7 = periodRange('7d', NOW);
    // last 7 local days incl. today → midnight 2026-06-04.
    expect(r7.startMs).toBe(new Date(2026, 5, 4, 0, 0, 0).getTime());
    expect(r7.startKey).toBe('2026-06-04');
    expect(r7.endKey).toBe('2026-06-10');
    const r30 = periodRange('30d', NOW);
    expect(r30.startMs).toBe(new Date(2026, 4, 12, 0, 0, 0).getTime());
    expect(r30.startKey).toBe('2026-05-12');
  });

  it('all starts at epoch', () => {
    const r = periodRange('all', NOW);
    expect(r.startMs).toBe(0);
    expect(r.endMs).toBe(NOW);
  });
});
