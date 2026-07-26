import { describe, expect, test } from 'vitest';
import { priceFor } from './pricing';

describe('pricing — newly added rows', () => {
  test('claude-opus-5 resolves', () => {
    expect(priceFor('claude-opus-5')).toEqual({
      displayName: 'Opus 5',
      provider: 'claude',
      rates: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }
    });
  });

  test('claude-opus-5[1m] (1M-context suffix) still resolves via longest-prefix match', () => {
    const entry = priceFor('claude-opus-5[1m]');
    expect(entry).not.toBeNull();
    expect(entry!.displayName).toBe('Opus 5');
  });

  test('claude-mythos-5 resolves', () => {
    expect(priceFor('claude-mythos-5')).toEqual({
      displayName: 'Mythos 5',
      provider: 'claude',
      rates: { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 }
    });
  });

  test('gpt-5.6-terra resolves (current default Codex model — was unpriced before this fix)', () => {
    expect(priceFor('gpt-5.6-terra')).toEqual({
      displayName: 'GPT-5.6 Terra',
      provider: 'codex',
      rates: { input: 2.5, output: 15, cacheRead: 0.25 }
    });
  });

  test('gpt-5.6-terra/high (compound effort id) still resolves via prefix match', () => {
    const entry = priceFor('gpt-5.6-terra/high');
    expect(entry).not.toBeNull();
    expect(entry!.displayName).toBe('GPT-5.6 Terra');
  });

  test('gpt-5.6-sol and gpt-5.6-luna both resolve', () => {
    expect(priceFor('gpt-5.6-sol')?.rates).toEqual({ input: 5, output: 30, cacheRead: 0.5 });
    expect(priceFor('gpt-5.6-luna')?.rates).toEqual({ input: 1, output: 6, cacheRead: 0.1 });
  });
});

describe('pricing — pre-existing rows are unaffected (no shadowing from new entries)', () => {
  test('claude-opus-4-8 still resolves to its own row, not claude-opus-5', () => {
    const entry = priceFor('claude-opus-4-8');
    expect(entry?.displayName).toBe('Opus 4.8');
  });

  test('gpt-5.4 still resolves to its own row, not gpt-5.6-*', () => {
    const entry = priceFor('gpt-5.4');
    expect(entry?.displayName).toBe('GPT-5.4');
  });

  test('claude-fable-5 is untouched', () => {
    expect(priceFor('claude-fable-5')?.rates).toEqual({ input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 });
  });
});
