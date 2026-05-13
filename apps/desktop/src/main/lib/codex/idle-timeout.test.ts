import { describe, expect, test } from 'vitest';
import { resolveCodexIdleTimeoutMs } from './idle-timeout';

describe('resolveCodexIdleTimeoutMs', () => {
  test('returns 180s for high effort', () => {
    expect(resolveCodexIdleTimeoutMs('gpt-5.4/high')).toBe(180_000);
  });

  test('returns 120s for medium effort', () => {
    expect(resolveCodexIdleTimeoutMs('gpt-5.4/medium')).toBe(120_000);
  });

  test('returns 60s for low effort', () => {
    expect(resolveCodexIdleTimeoutMs('gpt-5.4/low')).toBe(60_000);
  });

  test('returns the high default when no effort suffix is present', () => {
    expect(resolveCodexIdleTimeoutMs('gpt-5.4')).toBe(180_000);
  });

  test('returns the high default for an unrecognized effort tier', () => {
    expect(resolveCodexIdleTimeoutMs('gpt-5.4/insane')).toBe(180_000);
  });

  test('is case-insensitive on the effort suffix', () => {
    expect(resolveCodexIdleTimeoutMs('gpt-5.4/HIGH')).toBe(180_000);
    expect(resolveCodexIdleTimeoutMs('gpt-5.4/Medium')).toBe(120_000);
  });
});
