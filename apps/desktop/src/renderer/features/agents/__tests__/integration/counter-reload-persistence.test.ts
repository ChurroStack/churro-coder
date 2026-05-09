/**
 * L4 integration: context counter — close/open reload persistence.
 *
 * Proves that when the app is reloaded:
 *   - per-provider session-epoch atoms reset to 0 (in-memory by design)
 *   - persisted assistant messages — whose stamped `sessionEpoch` may be
 *     missing (older format) or non-zero (future-DB-persisted world) —
 *     remain visible to the resolver
 *   - the counter restores the last persisted numerator instead of
 *     showing a spurious 0
 *
 * Workflow assertion only. The resolver's pure logic is unit-tested in
 * `lib/context-usage.test.ts`.
 */
import { describe, test, expect, vi } from 'vitest';

vi.mock('../../../../lib/window-storage', async () => {
  const { atom } = await import('jotai');
  return {
    atomWithWindowStorage: (_key: string, defaultValue: unknown) => atom(defaultValue),
    createWindowScopedStorage: () => ({
      getItem: (_key: string, init: unknown) => init,
      setItem: () => {},
      removeItem: () => {}
    })
  };
});

import { appStore } from '../../../../lib/jotai-store';
import {
  subChatClaudeSessionEpochAtomFamily,
  subChatCodexModelIdAtomFamily,
  subChatCodexSessionEpochAtomFamily,
  subChatModelIdAtomFamily
} from '../../atoms';
import { resolveContextUsage } from '../../lib/context-usage';

let testCounter = 0;
const newSubChatId = () => `int-counter-reload-${++testCounter}`;

type Message = { role: 'assistant'; metadata: Record<string, number | string | undefined> };

function readResolverInputs(subChatId: string, provider: 'claude-code' | 'codex') {
  const claudeModelId = appStore.get(subChatModelIdAtomFamily(subChatId));
  const codexModelId = appStore.get(subChatCodexModelIdAtomFamily(subChatId));
  const claudeEpoch = appStore.get(subChatClaudeSessionEpochAtomFamily(subChatId));
  const codexEpoch = appStore.get(subChatCodexSessionEpochAtomFamily(subChatId));
  return {
    selectedProvider: provider,
    selectedModelId: provider === 'codex' ? codexModelId : claudeModelId,
    sessionEpoch: provider === 'codex' ? codexEpoch : claudeEpoch
  };
}

describe('L4 integration — context counter reload persistence', () => {
  test('persisted Claude messages without a sessionEpoch field still drive the counter on reload', () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModelIdAtomFamily(subChatId), 'sonnet');

    // The atom family always returns 0 for a never-touched sub-chat — that is
    // exactly what reload looks like.
    expect(appStore.get(subChatClaudeSessionEpochAtomFamily(subChatId))).toBe(0);

    const persisted: Message[] = [
      { role: 'assistant', metadata: { model: 'claude-sonnet-4-6', inputTokens: 80_000, cacheReadInputTokens: 20_000 } }
    ];

    const usage = resolveContextUsage({ messages: persisted, ...readResolverInputs(subChatId, 'claude-code') });
    expect(usage.totalInputTokens).toBe(100_000);
    expect(usage.contextWindow).toBe(200_000);
  });

  test('messages stamped with a future sessionEpoch are still visible on reload', () => {
    // This guards the "matches-or-newer" rule in the resolver: persisted
    // messages from a session whose epoch was higher than today's atom default
    // should not be filtered out — losing them on every reload would be a
    // user-visible counter regression.
    const subChatId = newSubChatId();
    appStore.set(subChatModelIdAtomFamily(subChatId), 'sonnet');

    const persisted: Message[] = [
      {
        role: 'assistant',
        metadata: { model: 'claude-sonnet-4-6', inputTokens: 50_000, sessionEpoch: 5 }
      }
    ];

    const usage = resolveContextUsage({ messages: persisted, ...readResolverInputs(subChatId, 'claude-code') });
    expect(usage.totalInputTokens).toBe(50_000);
  });

  test('an empty persisted history on reload renders the catalog window with 0 tokens', () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModelIdAtomFamily(subChatId), 'opus[1m]');

    const usage = resolveContextUsage({ messages: [], ...readResolverInputs(subChatId, 'claude-code') });
    expect(usage.totalInputTokens).toBe(0);
    expect(usage.contextWindow).toBe(1_000_000);
  });

  test('switching between sub-chats keeps each one keyed independently on its own atom family', () => {
    const subChatA = newSubChatId();
    const subChatB = newSubChatId();
    appStore.set(subChatModelIdAtomFamily(subChatA), 'sonnet');
    appStore.set(subChatModelIdAtomFamily(subChatB), 'sonnet');

    const messagesA: Message[] = [{ role: 'assistant', metadata: { model: 'claude-sonnet-4-6', inputTokens: 60_000 } }];
    const messagesB: Message[] = [];

    const aView = resolveContextUsage({ messages: messagesA, ...readResolverInputs(subChatA, 'claude-code') });
    const bView = resolveContextUsage({ messages: messagesB, ...readResolverInputs(subChatB, 'claude-code') });
    expect(aView.totalInputTokens).toBe(60_000);
    expect(bView.totalInputTokens).toBe(0);

    // Bumping A's epoch must not affect B's view — separate atom keys.
    const beforeB = appStore.get(subChatClaudeSessionEpochAtomFamily(subChatB));
    appStore.set(subChatClaudeSessionEpochAtomFamily(subChatA), 99);
    expect(appStore.get(subChatClaudeSessionEpochAtomFamily(subChatB))).toBe(beforeB);

    const aAfterReset = resolveContextUsage({ messages: messagesA, ...readResolverInputs(subChatA, 'claude-code') });
    const bAfterReset = resolveContextUsage({ messages: messagesB, ...readResolverInputs(subChatB, 'claude-code') });
    expect(aAfterReset.totalInputTokens).toBe(0);
    expect(bAfterReset.totalInputTokens).toBe(0);
  });
});
