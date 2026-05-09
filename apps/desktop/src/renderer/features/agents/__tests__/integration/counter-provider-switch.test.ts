/**
 * L4 integration: context counter — provider/model dropdown switch.
 *
 * Proves that when the user flips the chat-input model dropdown between
 * Claude and Codex, the resolver receives different selectedProvider /
 * selectedModelId / sessionEpoch inputs (from per-subChat atoms) and
 * produces correspondingly different outputs.
 *
 * Workflow assertion only. The resolver itself is unit-tested in
 * `lib/context-usage.test.ts`; this test verifies the atom→resolver
 * wiring shape that `active-chat.tsx` uses.
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
const newSubChatId = () => `int-counter-switch-${++testCounter}`;

type Message = { role: 'assistant'; metadata: Record<string, number | string | undefined> };

function seed(subChatId: string, claudeModel: string, codexModel: string) {
  appStore.set(subChatModelIdAtomFamily(subChatId), claudeModel);
  appStore.set(subChatCodexModelIdAtomFamily(subChatId), codexModel);
}

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

describe('L4 integration — context counter provider/model switch', () => {
  test('new sub-chat with no messages renders 0 against the selected Claude model window', () => {
    const subChatId = newSubChatId();
    seed(subChatId, 'sonnet', 'gpt-5.5');

    const usage = resolveContextUsage({ messages: [], ...readResolverInputs(subChatId, 'claude-code') });
    expect(usage.totalInputTokens).toBe(0);
    expect(usage.contextWindow).toBe(200_000);
  });

  test('flipping the dropdown to Codex on a Claude-only history snaps the counter to 0/Codex window', () => {
    const subChatId = newSubChatId();
    seed(subChatId, 'sonnet', 'gpt-5.5');
    const messages: Message[] = [
      { role: 'assistant', metadata: { model: 'claude-sonnet-4-6', inputTokens: 50_000, cacheReadInputTokens: 10_000 } }
    ];

    const claudeView = resolveContextUsage({ messages, ...readResolverInputs(subChatId, 'claude-code') });
    expect(claudeView.totalInputTokens).toBe(60_000);
    expect(claudeView.contextWindow).toBe(200_000);

    const codexView = resolveContextUsage({ messages, ...readResolverInputs(subChatId, 'codex') });
    expect(codexView.totalInputTokens).toBe(0);
    expect(codexView.contextWindow).toBe(1_050_000);
  });

  test('flipping back to Claude restores the Claude tokens', () => {
    const subChatId = newSubChatId();
    seed(subChatId, 'sonnet', 'gpt-5.5');
    const messages: Message[] = [{ role: 'assistant', metadata: { model: 'claude-sonnet-4-6', inputTokens: 70_000 } }];

    const before = resolveContextUsage({ messages, ...readResolverInputs(subChatId, 'claude-code') });
    const codex = resolveContextUsage({ messages, ...readResolverInputs(subChatId, 'codex') });
    const after = resolveContextUsage({ messages, ...readResolverInputs(subChatId, 'claude-code') });

    expect(before.totalInputTokens).toBe(70_000);
    expect(codex.totalInputTokens).toBe(0);
    expect(after.totalInputTokens).toBe(70_000);
  });

  test('interleaved Claude+Codex history exposes the right per-provider numerator', () => {
    const subChatId = newSubChatId();
    seed(subChatId, 'sonnet', 'gpt-5.5');
    const messages: Message[] = [
      { role: 'assistant', metadata: { model: 'claude-sonnet-4-6', inputTokens: 50_000 } },
      { role: 'assistant', metadata: { model: 'gpt-5.5', inputTokens: 80_000 } },
      { role: 'assistant', metadata: { model: 'claude-sonnet-4-6', inputTokens: 70_000 } }
    ];

    const claudeView = resolveContextUsage({ messages, ...readResolverInputs(subChatId, 'claude-code') });
    const codexView = resolveContextUsage({ messages, ...readResolverInputs(subChatId, 'codex') });

    expect(claudeView.totalInputTokens).toBe(70_000);
    expect(codexView.totalInputTokens).toBe(80_000);
  });

  test('switching the Claude model within the same provider rebases the denominator without losing tokens', () => {
    const subChatId = newSubChatId();
    seed(subChatId, 'sonnet', 'gpt-5.5');
    const messages: Message[] = [{ role: 'assistant', metadata: { model: 'claude-sonnet-4-6', inputTokens: 150_000 } }];

    const sonnetView = resolveContextUsage({ messages, ...readResolverInputs(subChatId, 'claude-code') });
    expect(sonnetView.totalInputTokens).toBe(150_000);
    expect(sonnetView.contextWindow).toBe(200_000);

    appStore.set(subChatModelIdAtomFamily(subChatId), 'opus[1m]');

    const opus1mView = resolveContextUsage({ messages, ...readResolverInputs(subChatId, 'claude-code') });
    expect(opus1mView.totalInputTokens).toBe(150_000);
    expect(opus1mView.contextWindow).toBe(1_000_000);
  });
});
