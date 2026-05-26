import { describe, expect, it } from 'vitest';
import { isPlaceholderName, sanitizePlanTitleForTab } from './placeholders';

describe('isPlaceholderName', () => {
  it('treats null as placeholder (NULL is the GC marker)', () => {
    expect(isPlaceholderName(null)).toBe(true);
  });

  it('treats undefined as placeholder', () => {
    expect(isPlaceholderName(undefined)).toBe(true);
  });

  it('treats "New Chat" as placeholder (renderer fallback casing)', () => {
    expect(isPlaceholderName('New Chat')).toBe(true);
  });

  it('treats "New chat" as placeholder (optimistic-insert casing)', () => {
    expect(isPlaceholderName('New chat')).toBe(true);
  });

  it('treats user-set names as non-placeholder', () => {
    expect(isPlaceholderName('My session')).toBe(false);
    expect(isPlaceholderName('Claude CLI')).toBe(false);
    expect(isPlaceholderName('')).toBe(false);
  });
});

describe('sanitizePlanTitleForTab', () => {
  it('returns empty for empty / whitespace input', () => {
    expect(sanitizePlanTitleForTab('')).toBe('');
    expect(sanitizePlanTitleForTab('   ')).toBe('');
  });

  it('strips leading "Plan:" prefix', () => {
    expect(sanitizePlanTitleForTab('Plan: build billing')).toBe('build billing');
  });

  it('strips leading "Plan -" / "Plan —" prefixes (case-insensitive)', () => {
    expect(sanitizePlanTitleForTab('Plan - add auth')).toBe('add auth');
    expect(sanitizePlanTitleForTab('plan — refactor')).toBe('refactor');
    expect(sanitizePlanTitleForTab('PLAN: do thing')).toBe('do thing');
  });

  it('strips markdown emphasis and inline code', () => {
    expect(sanitizePlanTitleForTab('**Add** `auth`')).toBe('Add auth');
    expect(sanitizePlanTitleForTab('__Bold__ and _italic_')).toBe('Bold and italic');
  });

  it('collapses runs of whitespace', () => {
    expect(sanitizePlanTitleForTab('Add    multiple   spaces')).toBe('Add multiple spaces');
  });

  it('returns empty for the bare "Plan" fallback sentinel', () => {
    expect(sanitizePlanTitleForTab('Plan')).toBe('');
  });

  it('clamps overlong titles to 80 chars with an ellipsis', () => {
    const long = 'a'.repeat(200);
    const out = sanitizePlanTitleForTab(long);
    expect(out.length).toBe(80);
    expect(out.endsWith('…')).toBe(true);
  });

  it('preserves a clean short title', () => {
    expect(sanitizePlanTitleForTab('Hello world')).toBe('Hello world');
  });
});
