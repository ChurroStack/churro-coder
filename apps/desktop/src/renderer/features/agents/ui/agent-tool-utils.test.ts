import { describe, expect, test } from 'vitest';
import { resolvePartStartedAt } from './agent-tool-utils';

describe('resolvePartStartedAt', () => {
  test('prefers call provider metadata', () => {
    expect(
      resolvePartStartedAt(
        {
          callProviderMetadata: { custom: { startedAt: 100 } },
          providerMetadata: { custom: { startedAt: 200 } },
          startedAt: 300
        },
        400
      )
    ).toBe(100);
  });

  test('falls back to provider metadata when call metadata is absent', () => {
    expect(
      resolvePartStartedAt(
        {
          providerMetadata: { custom: { startedAt: 200 } },
          startedAt: 300
        },
        400
      )
    ).toBe(200);
  });

  test('falls back to direct part startedAt before message time', () => {
    expect(resolvePartStartedAt({ startedAt: 300 }, 400)).toBe(300);
  });

  test('falls back to message created time when part metadata is missing', () => {
    expect(resolvePartStartedAt({}, 400)).toBe(400);
  });

  test('returns undefined when no timestamp is available', () => {
    expect(resolvePartStartedAt({})).toBeUndefined();
  });
});
