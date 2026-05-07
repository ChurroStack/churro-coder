// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { reduceProjectStatus } from './group-chats-by-project';

describe('reduceProjectStatus', () => {
  it('applies the expected priority order', () => {
    expect(reduceProjectStatus(['none', 'unseen', 'pendingPlan'])).toBe('pendingPlan');
    expect(reduceProjectStatus(['loading', 'unseen'])).toBe('loading');
    expect(reduceProjectStatus(['pendingQuestion', 'loading'])).toBe('pendingQuestion');
  });

  it('returns none for empty status lists', () => {
    expect(reduceProjectStatus([])).toBe('none');
  });
});
