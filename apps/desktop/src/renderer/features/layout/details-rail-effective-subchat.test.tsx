/**
 * DetailsRail sub-chat resolution contract.
 *
 * HISTORY: this file used to pin a local `computeEffectiveSubChatId` mirroring
 *   effectiveSubChatId = activeSubChatId ?? openSubChatIds[0] ?? chatId ?? ''
 * The `?? chatId` rung was a cross-namespace bug: it let the rail key
 * sub-chat-scoped state (plan/tasks/review) by a *chatId* whenever
 * activeSubChatId was momentarily null, so one workspace's data leaked into
 * another's sidebar during a switch.
 *
 * The rail now derives its sub-chat id from `useWorkspaceIdentity()`, whose
 * pure core is `resolveValidatedSubChatId`. The headline change pinned here:
 * when the store is NOT in sync with the selected chat (the exact frame a
 * switch produces), it returns null — never the previous workspace's sub-chat,
 * and never a chatId. Full matrix lives in
 * features/agents/hooks/use-workspace-identity.test.tsx.
 */
// @vitest-environment jsdom
import { describe, test, expect } from 'vitest';
import { resolveValidatedSubChatId } from '../agents/hooks/use-workspace-identity';

const all = (...ids: string[]) => ids.map((id) => ({ id }));

describe('details-rail sub-chat resolution (post cross-namespace-fix)', () => {
  test('uses the active sub-chat when in sync', () => {
    expect(resolveValidatedSubChatId(true, 'sc-active', ['sc-active'], all('sc-active'))).toBe('sc-active');
  });

  test('cold-mount: falls back to the only open sub-chat (still in sync)', () => {
    expect(resolveValidatedSubChatId(true, null, ['sc-cli'], all('sc-cli'))).toBe('sc-cli');
  });

  test('mid-switch (not in sync) → null, NOT the previous workspace’s sub-chat', () => {
    expect(resolveValidatedSubChatId(false, 'sc-prev', ['sc-prev'], all('sc-prev'))).toBe(null);
  });

  test('never collapses to a chatId — the removed `?? chatId` rung', () => {
    expect(resolveValidatedSubChatId(true, null, [], all('sc-1'))).toBe(null);
  });
});
