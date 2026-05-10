import { describe, expect, test } from 'vitest';
import { previewExternalUrl, validateExternalUrl } from './open-external';

describe('validateExternalUrl', () => {
  test('accepts absolute https urls', () => {
    expect(validateExternalUrl('https://www.churrostack.com/changelog#v1.2.3')).toEqual({
      ok: true,
      url: 'https://www.churrostack.com/changelog#v1.2.3'
    });
  });

  test('accepts mailto urls', () => {
    expect(validateExternalUrl('mailto:foo@bar.com')).toEqual({
      ok: true,
      url: 'mailto:foo@bar.com'
    });
  });

  test('rejects non-string input', () => {
    expect(validateExternalUrl(undefined as unknown as string)).toEqual({ ok: false, reason: 'empty' });
    expect(validateExternalUrl(null as unknown as string)).toEqual({ ok: false, reason: 'empty' });
  });

  test('rejects empty urls', () => {
    expect(validateExternalUrl('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  test('rejects malformed urls', () => {
    expect(validateExternalUrl('not a url')).toEqual({ ok: false, reason: 'invalid' });
  });

  test('rejects unsupported protocols', () => {
    expect(validateExternalUrl('javascript:alert(1)')).toEqual({
      ok: false,
      reason: 'unsupported-protocol'
    });
  });
});

describe('previewExternalUrl', () => {
  test('normalizes empty input for logs', () => {
    expect(previewExternalUrl('   ')).toBe('[empty]');
  });

  test('truncates long values for logs', () => {
    expect(previewExternalUrl(`https://example.com/${'a'.repeat(240)}`)).toMatch(/\.\.\.$/);
  });
});
