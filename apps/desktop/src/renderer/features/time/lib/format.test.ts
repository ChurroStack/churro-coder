import { describe, it, expect } from 'vitest';
import { formatDuration } from './format';

describe('formatDuration', () => {
  it('renders zero and sub-minute durations', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(-5)).toBe('0m');
    expect(formatDuration(20_000)).toBe('<1m');
  });

  it('renders minutes under an hour', () => {
    expect(formatDuration(42 * 60_000)).toBe('42m');
  });

  it('renders hours and minutes', () => {
    expect(formatDuration((3 * 60 + 42) * 60_000)).toBe('3h 42m');
  });
});
