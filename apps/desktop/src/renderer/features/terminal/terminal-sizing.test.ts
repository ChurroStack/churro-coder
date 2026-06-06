import { describe, it, expect } from 'vitest';
import { proposeGeometry, geometryChanged, colsChanged } from './terminal-sizing';

describe('proposeGeometry', () => {
  it('computes cols/rows from a normal measurement', () => {
    // ~1000px wide content, 8px cell -> 125 cols; 600px / 18px -> 33 rows
    expect(proposeGeometry({ width: 1000, height: 600, cellWidth: 8, cellHeight: 18 })).toEqual({
      cols: 125,
      rows: 33
    });
  });

  it('floors fractional cells (does not over-report columns)', () => {
    expect(proposeGeometry({ width: 999, height: 100, cellWidth: 8, cellHeight: 18 })).toEqual({
      cols: 124, // floor(999/8) = 124
      rows: 5 // floor(100/18) = 5
    });
  });

  it('returns null when the container width is zero (hidden/unlaid-out)', () => {
    // The exact "stuck at 2 cols" trigger: we must NOT commit here.
    expect(proposeGeometry({ width: 0, height: 600, cellWidth: 8, cellHeight: 18 })).toBeNull();
  });

  it('returns null when the container width is negative (padding > clientWidth)', () => {
    expect(proposeGeometry({ width: -16, height: 600, cellWidth: 8, cellHeight: 18 })).toBeNull();
  });

  it('returns null when the renderer cell size is not measured yet', () => {
    expect(proposeGeometry({ width: 1000, height: 600, cellWidth: 0, cellHeight: 0 })).toBeNull();
  });

  it('returns null when the available height is zero', () => {
    expect(proposeGeometry({ width: 1000, height: 0, cellWidth: 8, cellHeight: 18 })).toBeNull();
  });

  it('returns null rather than a 0-column geometry when width is smaller than one cell', () => {
    expect(proposeGeometry({ width: 5, height: 600, cellWidth: 8, cellHeight: 18 })).toBeNull();
  });
});

describe('geometryChanged', () => {
  it('is true when there is no previous geometry', () => {
    expect(geometryChanged(null, { cols: 80, rows: 24 })).toBe(true);
  });

  it('is false for identical geometry (prevents no-op PTY resizes)', () => {
    expect(geometryChanged({ cols: 80, rows: 24 }, { cols: 80, rows: 24 })).toBe(false);
  });

  it('is true when cols differ', () => {
    expect(geometryChanged({ cols: 80, rows: 24 }, { cols: 120, rows: 24 })).toBe(true);
  });

  it('is true when rows differ', () => {
    expect(geometryChanged({ cols: 80, rows: 24 }, { cols: 80, rows: 40 })).toBe(true);
  });
});

describe('colsChanged (gates stale-scrollback clear to width changes only)', () => {
  it('is false on the first commit (no prior history to invalidate)', () => {
    expect(colsChanged(null, { cols: 80, rows: 24 })).toBe(false);
  });

  it('is true when cols change (would leave prior scrollback hard-wrapped)', () => {
    expect(colsChanged({ cols: 80, rows: 24 }, { cols: 120, rows: 24 })).toBe(true);
  });

  it('is false when only rows change (height drag must not wipe history)', () => {
    expect(colsChanged({ cols: 80, rows: 24 }, { cols: 80, rows: 40 })).toBe(false);
  });

  it('is false when geometry is unchanged', () => {
    expect(colsChanged({ cols: 80, rows: 24 }, { cols: 80, rows: 24 })).toBe(false);
  });
});
