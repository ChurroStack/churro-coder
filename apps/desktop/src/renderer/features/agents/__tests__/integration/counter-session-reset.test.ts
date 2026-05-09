/**
 * L4 integration: context counter — session reset paths.
 *
 * Proves that the three reset sites bump the right per-provider epoch
 * such that the resolver immediately filters pre-reset assistant turns:
 *   1. plan approval (`resetSessionTracking` deps callback bumps both)
 *   2. Claude `/compact` finish (transport bumps the Claude epoch)
 *   3. `markCodexFreshNextTurn` callsite (caller bumps the Codex epoch
 *      explicitly via `resetSessionTracking` — `markCodexFreshNextTurn`
 *      itself is a Set-only mutation by design)
 *
 * Workflow assertions only — no React, no real transports. Each test
 * drives the same mutation the production code performs and asserts the
 * resolver agrees.
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
  bumpSessionEpoch,
  defaultExecuteModeModelAtom,
  defaultPlanModeModelAtom,
  subChatClaudeSessionEpochAtomFamily,
  subChatCodexModelIdAtomFamily,
  subChatCodexSessionEpochAtomFamily,
  subChatModelIdAtomFamily,
  subChatModeAtomFamily,
  subChatProviderOverrideAtomFamily
} from '../../atoms';
import { resolveContextUsage } from '../../lib/context-usage';
import { applyModeDefaultModel } from '../../lib/model-switching';
import { markCodexFreshNextTurn } from '../../lib/codex-chat-transport';
import { approvePlan, type PlanApprovalDeps } from '../../services/plan-approval-service';

vi.mock('../../lib/codex-chat-transport', async () => {
  const actual = await vi.importActual<typeof import('../../lib/codex-chat-transport')>(
    '../../lib/codex-chat-transport'
  );
  return {
    ...actual,
    markCodexFreshNextTurn: vi.fn()
  };
});

let testCounter = 0;
const newSubChatId = () => `int-counter-reset-${++testCounter}`;

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

function makeDeps(): PlanApprovalDeps {
  return {
    readPreviousProvider: () => 'claude-code',
    setMode: (id, mode) => appStore.set(subChatModeAtomFamily(id), mode),
    persistMode: async () => {},
    resetSessionTracking: (id) => {
      bumpSessionEpoch(id, 'claude-code', appStore.set);
      bumpSessionEpoch(id, 'codex', appStore.set);
      markCodexFreshNextTurn(id);
    },
    applyDefaultModel: (id, mode) => {
      const r = applyModeDefaultModel(id, mode);
      return { provider: r.provider, isRemote: false };
    },
    notifyProviderChange: () => {},
    resolvePlanContent: async () => null,
    ensurePlanPersisted: async () => {},
    buildImplementPlanParts: () => [{ type: 'text', text: 'x' }],
    isInFlight: () => false,
    markInFlight: () => {},
    releaseInFlight: () => {},
    scheduleDeferredSend: () => {}
  };
}

describe('L4 integration — context counter session reset', () => {
  test('approvePlan drops the Claude counter to 0 even with planner messages still rendered', async () => {
    const subChatId = newSubChatId();
    appStore.set(defaultPlanModeModelAtom, 'opus[1m]');
    appStore.set(defaultExecuteModeModelAtom, 'sonnet');
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');
    appStore.set(subChatProviderOverrideAtomFamily(subChatId), 'claude-code');
    appStore.set(subChatModelIdAtomFamily(subChatId), 'opus[1m]');

    const claudeEpochBefore = appStore.get(subChatClaudeSessionEpochAtomFamily(subChatId));
    const plannerMessages: Message[] = [
      {
        role: 'assistant',
        metadata: { model: 'claude-opus-4-7', inputTokens: 100_000, sessionEpoch: claudeEpochBefore }
      }
    ];

    const before = resolveContextUsage({ messages: plannerMessages, ...readResolverInputs(subChatId, 'claude-code') });
    expect(before.totalInputTokens).toBe(100_000);

    const result = await approvePlan(subChatId, makeDeps());
    expect(result.ok).toBe(true);

    const after = resolveContextUsage({ messages: plannerMessages, ...readResolverInputs(subChatId, 'claude-code') });
    expect(after.totalInputTokens).toBe(0);
  });

  test('approvePlan also clears the Codex counter for cross-provider execute', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');
    appStore.set(subChatProviderOverrideAtomFamily(subChatId), 'claude-code');
    appStore.set(subChatModelIdAtomFamily(subChatId), 'opus[1m]');
    appStore.set(subChatCodexModelIdAtomFamily(subChatId), 'gpt-5.5');

    const codexEpochBefore = appStore.get(subChatCodexSessionEpochAtomFamily(subChatId));
    const plannerMessages: Message[] = [
      // A Codex turn that exists in this sub-chat from before approval (e.g. via manual handoff).
      {
        role: 'assistant',
        metadata: { model: 'gpt-5.5', inputTokens: 60_000, sessionEpoch: codexEpochBefore }
      }
    ];

    const result = await approvePlan(subChatId, makeDeps());
    expect(result.ok).toBe(true);

    const after = resolveContextUsage({ messages: plannerMessages, ...readResolverInputs(subChatId, 'codex') });
    expect(after.totalInputTokens).toBe(0);
  });

  test('Claude /compact finished bumps only the Claude epoch and leaves Codex untouched', () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModelIdAtomFamily(subChatId), 'sonnet');
    appStore.set(subChatCodexModelIdAtomFamily(subChatId), 'gpt-5.5');

    const claudeBefore = appStore.get(subChatClaudeSessionEpochAtomFamily(subChatId));
    const codexBefore = appStore.get(subChatCodexSessionEpochAtomFamily(subChatId));

    const messages: Message[] = [
      { role: 'assistant', metadata: { model: 'claude-sonnet-4-6', inputTokens: 60_000, sessionEpoch: claudeBefore } },
      { role: 'assistant', metadata: { model: 'gpt-5.5', inputTokens: 90_000, sessionEpoch: codexBefore } }
    ];

    // Simulate the IPC transport's compact-finished handler.
    bumpSessionEpoch(subChatId, 'claude-code', appStore.set);

    const claude = resolveContextUsage({ messages, ...readResolverInputs(subChatId, 'claude-code') });
    const codex = resolveContextUsage({ messages, ...readResolverInputs(subChatId, 'codex') });
    expect(claude.totalInputTokens).toBe(0);
    expect(codex.totalInputTokens).toBe(90_000);
    expect(appStore.get(subChatCodexSessionEpochAtomFamily(subChatId))).toBe(codexBefore);
  });

  test('Codex epoch bump leaves Claude history visible', () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModelIdAtomFamily(subChatId), 'sonnet');
    appStore.set(subChatCodexModelIdAtomFamily(subChatId), 'gpt-5.5');

    const claudeBefore = appStore.get(subChatClaudeSessionEpochAtomFamily(subChatId));
    const codexBefore = appStore.get(subChatCodexSessionEpochAtomFamily(subChatId));

    const messages: Message[] = [
      { role: 'assistant', metadata: { model: 'claude-sonnet-4-6', inputTokens: 60_000, sessionEpoch: claudeBefore } },
      { role: 'assistant', metadata: { model: 'gpt-5.5', inputTokens: 90_000, sessionEpoch: codexBefore } }
    ];

    bumpSessionEpoch(subChatId, 'codex', appStore.set);

    const claude = resolveContextUsage({ messages, ...readResolverInputs(subChatId, 'claude-code') });
    const codex = resolveContextUsage({ messages, ...readResolverInputs(subChatId, 'codex') });
    expect(claude.totalInputTokens).toBe(60_000);
    expect(codex.totalInputTokens).toBe(0);
    expect(appStore.get(subChatClaudeSessionEpochAtomFamily(subChatId))).toBe(claudeBefore);
  });
});
