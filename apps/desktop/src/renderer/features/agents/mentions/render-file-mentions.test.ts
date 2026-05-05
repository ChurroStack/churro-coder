import { describe, expect, test, vi } from 'vitest';

vi.mock('./agents-file-mention', () => ({
  getFileIconByExtension: () => null
}));

import { messageToTitleText } from './render-file-mentions';

describe('messageToTitleText', () => {
  test('returns trimmed typed text when there are no mention tokens', () => {
    expect(messageToTitleText('  Help me debug this  ')).toBe('Help me debug this');
  });

  test('strips pasted mention tokens when typed text is present', () => {
    expect(messageToTitleText('Help me with this @[pasted:6248:claude Session output|/tmp/paste.txt]')).toBe(
      'Help me with this'
    );
  });

  test('falls back to pasted preview when input is only a pasted token', () => {
    expect(messageToTitleText('@[pasted:6248:claude Session output|/tmp/paste.txt]')).toBe('claude Session output');
  });

  test('falls back to the first mention label when multiple tokens have no typed text', () => {
    expect(
      messageToTitleText(
        '@[chatHistory:200:Previous chat summary|/tmp/chat.md] @[pasted:6248:claude Session output|/tmp/paste.txt]'
      )
    ).toBe('Previous chat summary');
  });

  test('returns empty string for empty input', () => {
    expect(messageToTitleText('')).toBe('');
  });
});
