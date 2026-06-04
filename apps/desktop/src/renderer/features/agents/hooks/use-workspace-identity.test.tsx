// @vitest-environment jsdom
// jsdom provides `window`, which the atoms module touches at import time
// (atomWithWindowStorage → getWindowId → window.location).
import { describe, test, expect } from 'vitest';
import { resolveValidatedSubChatId } from './use-workspace-identity';

const all = (...ids: string[]) => ids.map((id) => ({ id }));

describe('resolveValidatedSubChatId — the guard that stops cross-workspace leaks', () => {
  test('returns the active sub-chat when in sync and it is open', () => {
    expect(resolveValidatedSubChatId(true, 'sc-active', ['sc-active', 'sc-other'], all('sc-active', 'sc-other'))).toBe(
      'sc-active'
    );
  });

  test('falls back to openSubChatIds[0] when active is null (cold-mount), but only in sync', () => {
    expect(resolveValidatedSubChatId(true, null, ['sc-cli'], all('sc-cli'))).toBe('sc-cli');
  });

  test('NOT in sync → null (never the previous workspace’s sub-chat) — the headline fix', () => {
    // store still holds chat A's active id, but selectedChatId already flipped
    // to chat B, so inSync is false. Must be null, NOT 'sc-A'.
    expect(resolveValidatedSubChatId(false, 'sc-A', ['sc-A'], all('sc-A'))).toBe(null);
  });

  test('candidate not in openSubChatIds → null', () => {
    expect(resolveValidatedSubChatId(true, 'sc-ghost', ['sc-real'], all('sc-real'))).toBe(null);
  });

  test('candidate not in a hydrated allSubChats → null (stale store vs DB)', () => {
    expect(resolveValidatedSubChatId(true, 'sc-x', ['sc-x'], all('sc-y'))).toBe(null);
  });

  test('trusts localStorage active id while allSubChats is still empty (pre-hydration)', () => {
    // On restart, openSubChatIds/active load synchronously but allSubChats
    // hydrates async — must not blank the sidebar in the meantime.
    expect(resolveValidatedSubChatId(true, 'sc-restored', ['sc-restored'], [])).toBe('sc-restored');
  });

  test('no candidate at all → null', () => {
    expect(resolveValidatedSubChatId(true, null, [], [])).toBe(null);
  });

  test('never collapses to a chatId — there is no chatId rung', () => {
    // The old bug: `activeSubChatId ?? openSubChatIds[0] ?? chatId`. A chatId is
    // never a valid sub-chat id, so when nothing resolves we get null, full stop.
    expect(resolveValidatedSubChatId(true, null, [], all('sc-1'))).toBe(null);
  });
});
