/**
 * L4 integration: plan → approve → agent (same-provider) flow.
 *
 * Verifies the **workflow**, not the LLM output. The orchestrator must:
 *   1. Capture the planner's provider BEFORE applyDefaultModel writes the
 *      provider override atom (PR #40).
 *   2. Flip `subChatModeAtomFamily` to "agent" synchronously (PR #36, #38).
 *   3. Apply the configured agent-mode default model (PR #38, #32).
 *   4. Persist with `exitPlan: true` so the server clears sessionId (PR #45).
 *   5. Keep the same transport for same-provider approvals (PR #44).
 *   6. Schedule the deferred send exactly once.
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
  defaultAgentModeModelAtom,
  defaultAgentModeThinkingAtom,
  defaultPlanModeModelAtom,
  defaultPlanModeThinkingAtom,
  subChatClaudeThinkingAtomFamily,
  subChatCodexModelIdAtomFamily,
  subChatCodexThinkingAtomFamily,
  subChatModeAtomFamily,
  subChatModelIdAtomFamily,
  subChatProviderOverrideAtomFamily
} from '../../atoms';
import { applyModeDefaultModel } from '../../lib/model-switching';
import { approvePlan, type PlanApprovalDeps } from '../../services/plan-approval-service';
import type { ProviderId } from '../../machines/transport-lifecycle';

let testCounter = 0;
const newSubChatId = () => `int-plan-${++testCounter}`;

beforeEach(() => {
  appStore.set(defaultPlanModeModelAtom, 'opus[1m]');
  appStore.set(defaultAgentModeModelAtom, 'sonnet');
  appStore.set(defaultPlanModeThinkingAtom, 'high');
  appStore.set(defaultAgentModeThinkingAtom, 'high');
});

interface OrchestrationResult {
  scheduledSends: { subChatId: string; parts: unknown[] }[];
  notifyCalls: { subChatId: string; provider: ProviderId }[];
  persistCalls: { subChatId: string; mode: string; exitPlan: boolean }[];
  inFlight: Set<string>;
}

function makeRealisticDeps(opts: { subChatId: string; initialProvider: ProviderId }): {
  deps: PlanApprovalDeps;
  orchestration: OrchestrationResult;
} {
  const orchestration: OrchestrationResult = {
    scheduledSends: [],
    notifyCalls: [],
    persistCalls: [],
    inFlight: new Set()
  };

  // Seed the planner's provider override so readPreviousProvider sees it.
  appStore.set(subChatProviderOverrideAtomFamily(opts.subChatId), opts.initialProvider);

  const deps: PlanApprovalDeps = {
    readPreviousProvider: (subChatId) => appStore.get(subChatProviderOverrideAtomFamily(subChatId)) ?? 'claude-code',
    setMode: (subChatId, mode) => {
      // Mirror the renderer: write the per-subChat atom + storage atom (omitted for brevity here
      // — the integration test asserts on subChatModeAtomFamily directly).
      appStore.set(subChatModeAtomFamily(subChatId), mode);
    },
    persistMode: async (input) => {
      orchestration.persistCalls.push(input);
    },
    applyDefaultModel: (subChatId, mode) => {
      // Use the REAL applyModeDefaultModel — this is the integration boundary.
      const result = applyModeDefaultModel(subChatId, mode);
      // Plan-approval cross-provider needs both modelId AND provider.
      // The plan-approval-service uses { provider, isRemote }; isRemote is unrelated to
      // model defaults, so we pass false for local chats.
      return { provider: result.provider, isRemote: false };
    },
    notifyProviderChange: (subChatId, provider) => {
      orchestration.notifyCalls.push({ subChatId, provider });
    },
    resolvePlanContent: async () => null,
    buildImplementPlanParts: (payload) =>
      payload.kind === 'text-only'
        ? [{ type: 'text', text: payload.text }]
        : [
            { type: 'text', text: payload.text },
            { type: 'file', planContent: payload.planContent }
          ],
    isInFlight: (subChatId) => orchestration.inFlight.has(subChatId),
    markInFlight: (subChatId) => orchestration.inFlight.add(subChatId),
    releaseInFlight: (subChatId) => orchestration.inFlight.delete(subChatId),
    scheduleDeferredSend: (subChatId, parts) => {
      orchestration.scheduledSends.push({ subChatId, parts });
    }
  };

  return { deps, orchestration };
}

describe('L4 integration — plan → agent same-provider Claude→Claude (PR #36, #38, #44, #45, #51)', () => {
  test('approve flips mode atom to agent and applies sonnet model synchronously', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');
    appStore.set(subChatModelIdAtomFamily(subChatId), 'opus[1m]');

    const { deps, orchestration } = makeRealisticDeps({
      subChatId,
      initialProvider: 'claude-code'
    });

    const result = await approvePlan(subChatId, deps);

    expect(result.ok).toBe(true);
    expect(result.transportAction).toEqual({ kind: 'keep' });

    // Mode atom flipped.
    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('agent');
    // Model atom now holds the configured agent-mode default (sonnet).
    expect(appStore.get(subChatModelIdAtomFamily(subChatId))).toBe('sonnet');
    // Thinking propagated.
    expect(appStore.get(subChatClaudeThinkingAtomFamily(subChatId))).toBe('high');
    // Provider override stays claude-code.
    expect(appStore.get(subChatProviderOverrideAtomFamily(subChatId))).toBe('claude-code');
    // Persist called with exitPlan: true (PR #45).
    expect(orchestration.persistCalls).toEqual([{ subChatId, mode: 'agent', exitPlan: true }]);
    // Same-provider: no notifyProviderChange.
    expect(orchestration.notifyCalls).toEqual([]);
    // Exactly one deferred send scheduled.
    expect(orchestration.scheduledSends).toHaveLength(1);
    expect(orchestration.scheduledSends[0].subChatId).toBe(subChatId);
  });

  test('approve flips mode atom to agent and applies the configured Codex agent default — Codex→Codex', async () => {
    const subChatId = newSubChatId();
    appStore.set(defaultAgentModeModelAtom, 'gpt-5.4');
    appStore.set(defaultAgentModeThinkingAtom, 'medium');
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');
    appStore.set(subChatCodexModelIdAtomFamily(subChatId), 'gpt-5.3-codex');

    const { deps, orchestration } = makeRealisticDeps({
      subChatId,
      initialProvider: 'codex'
    });

    const result = await approvePlan(subChatId, deps);
    expect(result.ok).toBe(true);
    expect(result.transportAction).toEqual({ kind: 'keep' });

    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('agent');
    expect(appStore.get(subChatCodexModelIdAtomFamily(subChatId))).toBe('gpt-5.4');
    expect(appStore.get(subChatCodexThinkingAtomFamily(subChatId))).toBe('medium');
    expect(appStore.get(subChatProviderOverrideAtomFamily(subChatId))).toBe('codex');

    // Same-provider: no transport recreate, no notifyProviderChange.
    expect(orchestration.notifyCalls).toEqual([]);
    // One deferred send.
    expect(orchestration.scheduledSends).toHaveLength(1);
  });
});

describe('L4 integration — single-flight (PR #51)', () => {
  test('two parallel approvePlan calls only schedule one deferred send', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');

    const { deps, orchestration } = makeRealisticDeps({
      subChatId,
      initialProvider: 'claude-code'
    });

    // Hold the persist promise open so the first call is mid-flight when the
    // second arrives. Container ref so TS sees the assignment across the
    // async Promise callback.
    const resolver: { fn: (() => void) | null } = { fn: null };
    deps.persistMode = async (input) => {
      orchestration.persistCalls.push(input);
      await new Promise<void>((res) => {
        resolver.fn = res;
      });
    };

    const first = approvePlan(subChatId, deps);
    await new Promise((r) => setTimeout(r, 0));

    const second = await approvePlan(subChatId, deps);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('in-flight');

    resolver.fn?.();
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);

    // Only one deferred send.
    expect(orchestration.scheduledSends).toHaveLength(1);
  });
});
