import { describe, expect, it } from 'vitest';
import { trimEmptyLeadingWeeks } from './heatmap';

const cell = (weekIndex: number, dayOfWeek: number, commits: number) => ({
  date: `w${weekIndex}-d${dayOfWeek}`,
  weekIndex,
  dayOfWeek,
  commits
});

describe('trimEmptyLeadingWeeks', () => {
  it('returns the same array when there are no commits at all', () => {
    const cells = [cell(0, 0, 0), cell(1, 0, 0), cell(2, 0, 0)];
    expect(trimEmptyLeadingWeeks(cells)).toBe(cells);
  });

  it('returns the same array when the first week already has activity', () => {
    const cells = [cell(0, 0, 1), cell(1, 0, 0), cell(2, 0, 3)];
    expect(trimEmptyLeadingWeeks(cells)).toBe(cells);
  });

  it('keeps 1 week of padding before the first active week and re-indexes', () => {
    // Commits land in weeks 5 and 6 of a 10-week grid. Should trim to weeks 4..9
    // and re-index them as 0..5.
    const cells = [];
    for (let w = 0; w < 10; w++) {
      cells.push(cell(w, 0, w === 5 || w === 6 ? 2 : 0));
    }
    const trimmed = trimEmptyLeadingWeeks(cells);
    expect(trimmed.length).toBe(6); // weeks 4..9 inclusive
    expect(trimmed[0]?.weekIndex).toBe(0);
    expect(trimmed[trimmed.length - 1]?.weekIndex).toBe(5);
    // The cell that was at week 5 with commits=2 is now at index 1 (after 1-week padding).
    const active = trimmed.find((c) => c.commits === 2);
    expect(active?.weekIndex).toBe(1);
  });

  it('does not pad below week 0 when the first commit is in week 0', () => {
    const cells = [cell(0, 0, 5), cell(1, 0, 0)];
    expect(trimEmptyLeadingWeeks(cells)).toBe(cells);
  });
});
