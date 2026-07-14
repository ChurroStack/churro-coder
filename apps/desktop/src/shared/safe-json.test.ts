import { describe, expect, test } from 'vitest';
import { stringifyForError } from './safe-json';

describe('stringifyForError', () => {
  test('returns strings unchanged', () => {
    expect(stringifyForError('invalid model')).toBe('invalid model');
  });

  test('serializes circular objects without throwing', () => {
    const payload: Record<string, unknown> = { code: 422 };
    payload.self = payload;

    expect(stringifyForError(payload)).toBe('{"code":422,"self":"[Circular]"}');
  });
});
