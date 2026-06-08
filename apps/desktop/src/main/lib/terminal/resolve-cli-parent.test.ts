import { describe, test, expect, beforeEach, vi } from 'vitest';

// Mock the db barrel so this runs without the native better-sqlite3 module.
const getRow = vi.fn();
vi.mock('../db', () => ({
  getDatabase: () => ({
    select: () => ({ from: () => ({ where: () => ({ get: getRow }) }) })
  }),
  subChats: { id: 'id', chatId: 'chat_id' }
}));

import { resolveCliParentChatId, clearCliParentCache } from './resolve-cli-parent';

describe('resolveCliParentChatId', () => {
  beforeEach(() => {
    clearCliParentCache();
    getRow.mockReset();
  });

  test('returns the session parentChatId without a DB hit when present', () => {
    expect(resolveCliParentChatId('sub-1', 'ws-a')).toBe('ws-a');
    expect(getRow).not.toHaveBeenCalled();
  });

  test('falls back to subChats.chatId when the session parent is null', () => {
    getRow.mockReturnValue({ chatId: 'ws-b' });
    expect(resolveCliParentChatId('sub-2', null)).toBe('ws-b');
  });

  test('caches a successful lookup (one DB hit across repeated events)', () => {
    getRow.mockReturnValue({ chatId: 'ws-c' });
    resolveCliParentChatId('sub-3', null);
    resolveCliParentChatId('sub-3', null);
    expect(getRow).toHaveBeenCalledTimes(1);
  });

  test('does NOT cache a null result (retries on a later event)', () => {
    getRow.mockReturnValueOnce(undefined).mockReturnValueOnce({ chatId: 'ws-d' });
    expect(resolveCliParentChatId('sub-4', null)).toBe(null);
    expect(resolveCliParentChatId('sub-4', null)).toBe('ws-d');
    expect(getRow).toHaveBeenCalledTimes(2);
  });

  test('returns null and does not throw when the lookup throws', () => {
    getRow.mockImplementation(() => {
      throw new Error('db unavailable');
    });
    expect(resolveCliParentChatId('sub-5', null)).toBe(null);
  });
});
