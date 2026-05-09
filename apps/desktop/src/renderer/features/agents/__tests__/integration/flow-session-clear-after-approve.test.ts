/**
 * L4 integration: session clear after approve (PR #45).
 *
 * After a plan approval, the server must start a fresh agent session — not
 * resume the plan-mode session. The orchestrator persists the mode change
 * with `exitPlan: true`, which the server uses to null out `sessionId` and
 * `sessionMode` in the DB.
 *
 * This test verifies the wire-format expected by `chats.updateSubChatMode`:
 *   - `exitPlan: true` is included.
 *   - The persist is awaited BEFORE the deferred send schedules.
 *   - If the persist fails, the deferred send does NOT fire (so we don't
 *     send "Implement plan" to a stale plan-mode session).
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';

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
  subChatCodexSessionEpochAtomFamily,
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
const newSubChatId = () => `int-session-${++testCounter}`;

beforeEach(() => {
  appStore.set(defaultPlanModeModelAtom, 'opus[1m]');
  appStore.set(defaultExecuteModeModelAtom, 'sonnet');
});

describe('L4 integration — session clear via persistMode exitPlan flag (PR #45)', () => {
  test('persistMode receives { exitPlan: true } on plan approval', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');
    appStore.set(subChatProviderOverrideAtomFamily(subChatId), 'claude-code');

    const persistCalls: { subChatId: string; mode: string; exitPlan: boolean }[] = [];

    const deps: PlanApprovalDeps = {
      readPreviousProvider: () => 'claude-code',
      setMode: (id, mode) => appStore.set(subChatModeAtomFamily(id), mode),
      persistMode: async (input) => {
        persistCalls.push(input);
      },
      applyDefaultModel: (id, mode) => {
        const result = applyModeDefaultModel(id, mode);
        return { provider: result.provider, isRemote: false };
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

    const result = await approvePlan(subChatId, deps);
    expect(result.ok).toBe(true);
    expect(persistCalls).toEqual([{ subChatId, mode: 'execute', exitPlan: true }]);
  });

  test('persistMode is awaited before scheduleDeferredSend (no stale session resume)', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');

    const events: string[] = [];
    const resolver: { fn: (() => void) | null } = { fn: null };
    const persistGate = new Promise<void>((res) => {
      resolver.fn = res;
    });

    const deps: PlanApprovalDeps = {
      readPreviousProvider: () => 'claude-code',
      setMode: (id, mode) => appStore.set(subChatModeAtomFamily(id), mode),
      persistMode: async () => {
        events.push('persistMode-enter');
        await persistGate;
        events.push('persistMode-exit');
      },
      applyDefaultModel: (id, mode) => {
        const result = applyModeDefaultModel(id, mode);
        return { provider: result.provider, isRemote: false };
      },
      notifyProviderChange: () => {},
      resolvePlanContent: async () => null,
      ensurePlanPersisted: async () => {},
      buildImplementPlanParts: () => [{ type: 'text', text: 'x' }],
      isInFlight: () => false,
      markInFlight: () => {},
      releaseInFlight: () => {},
      scheduleDeferredSend: () => {
        events.push('scheduleDeferredSend');
      }
    };

    const flow = approvePlan(subChatId, deps);
    await new Promise((r) => setTimeout(r, 0));

    expect(events).toEqual(['persistMode-enter']);
    expect(events).not.toContain('scheduleDeferredSend');

    resolver.fn?.();
    await flow;

    expect(events).toEqual(['persistMode-enter', 'persistMode-exit', 'scheduleDeferredSend']);
  });

  test('persistMode failure → no deferred send fires', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');

    const scheduledSends: { subChatId: string; parts: unknown[] }[] = [];

    const deps: PlanApprovalDeps = {
      readPreviousProvider: () => 'claude-code',
      setMode: (id, mode) => appStore.set(subChatModeAtomFamily(id), mode),
      persistMode: async () => {
        throw new Error('DB locked');
      },
      applyDefaultModel: (id, mode) => {
        const result = applyModeDefaultModel(id, mode);
        return { provider: result.provider, isRemote: false };
      },
      notifyProviderChange: () => {},
      resolvePlanContent: async () => null,
      ensurePlanPersisted: async () => {},
      buildImplementPlanParts: () => [{ type: 'text', text: 'x' }],
      isInFlight: () => false,
      markInFlight: () => {},
      releaseInFlight: () => {},
      scheduleDeferredSend: (id, parts) => {
        scheduledSends.push({ subChatId: id, parts });
      }
    };

    const result = await approvePlan(subChatId, deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('persist-failed');
    expect(scheduledSends).toEqual([]);
  });

  test('after persistMode failure, the in-flight lock is released so retry is possible', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');

    const inFlight = new Set<string>();
    let firstAttempt = true;
    const deps: PlanApprovalDeps = {
      readPreviousProvider: () => 'claude-code',
      setMode: (id, mode) => appStore.set(subChatModeAtomFamily(id), mode),
      persistMode: async () => {
        if (firstAttempt) {
          firstAttempt = false;
          throw new Error('transient');
        }
      },
      applyDefaultModel: (id, mode) => {
        const result = applyModeDefaultModel(id, mode);
        return { provider: result.provider, isRemote: false };
      },
      notifyProviderChange: () => {},
      resolvePlanContent: async () => null,
      ensurePlanPersisted: async () => {},
      buildImplementPlanParts: () => [{ type: 'text', text: 'x' }],
      isInFlight: (id) => inFlight.has(id),
      markInFlight: (id) => inFlight.add(id),
      releaseInFlight: (id) => inFlight.delete(id),
      scheduleDeferredSend: () => {}
    };

    const r1 = await approvePlan(subChatId, deps);
    expect(r1.ok).toBe(false);
    expect(inFlight.has(subChatId)).toBe(false);

    const r2 = await approvePlan(subChatId, deps);
    expect(r2.ok).toBe(true);
  });

  test('Codex approve path marks the next turn as a fresh session after persist succeeds', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');
    appStore.set(subChatProviderOverrideAtomFamily(subChatId), 'codex');

    const deps: PlanApprovalDeps = {
      readPreviousProvider: () => 'codex',
      setMode: (id, mode) => appStore.set(subChatModeAtomFamily(id), mode),
      persistMode: async () => {
        markCodexFreshNextTurn(subChatId);
      },
      applyDefaultModel: (id, mode) => {
        const result = applyModeDefaultModel(id, mode);
        return { provider: result.provider, isRemote: false };
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

    const result = await approvePlan(subChatId, deps);
    expect(result.ok).toBe(true);
    expect(markCodexFreshNextTurn).toHaveBeenCalledWith(subChatId);
  });

  test('resetSessionTracking bumps both per-provider epochs so the indicator drops to 0', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');
    appStore.set(subChatProviderOverrideAtomFamily(subChatId), 'claude-code');

    const claudeBefore = appStore.get(subChatClaudeSessionEpochAtomFamily(subChatId));
    const codexBefore = appStore.get(subChatCodexSessionEpochAtomFamily(subChatId));

    const deps: PlanApprovalDeps = {
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

    const result = await approvePlan(subChatId, deps);
    expect(result.ok).toBe(true);

    const claudeAfter = appStore.get(subChatClaudeSessionEpochAtomFamily(subChatId));
    const codexAfter = appStore.get(subChatCodexSessionEpochAtomFamily(subChatId));
    expect(claudeAfter).toBeGreaterThan(claudeBefore);
    expect(codexAfter).toBeGreaterThan(codexBefore);

    // Pre-approval Claude turn (epoch = before-bump) must be filtered out by the resolver.
    const planTurn = {
      role: 'assistant' as const,
      metadata: { model: 'claude-sonnet-4-6', inputTokens: 80_000, sessionEpoch: claudeBefore }
    };
    const usage = resolveContextUsage({
      messages: [planTurn],
      selectedProvider: 'claude-code',
      selectedModelId: 'sonnet',
      sessionEpoch: claudeAfter
    });
    expect(usage.totalInputTokens).toBe(0);
  });
});
