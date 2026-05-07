/**
 * L4 integration: cross-provider plan approval (PR #52, #40, #44).
 *
 * Specific scenario from the postmortem: Codex GPT-5.5 plan, agent-mode
 * default = Claude Sonnet. Approve must:
 *   1. Snapshot previousProvider="codex" BEFORE applyDefaultModel writes
 *      `subChatProviderOverrideAtomFamily(...)` to "claude-code" (PR #40).
 *   2. Apply the Claude agent default synchronously (PR #36, #38).
 *   3. Notify the renderer to recreate the transport (PR #52).
 *   4. Resolve plan content asynchronously and attach as a hidden file part.
 *   5. Return action.kind === "recreate" with provider="claude-code".
 *
 * The test captures the provider override atom value at each step to make
 * sure no async gap can let a stale provider read sneak through.
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
  defaultExecuteModeModelAtom,
  defaultExecuteModeThinkingAtom,
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
const newSubChatId = () => `int-cross-${++testCounter}`;

beforeEach(() => {
  appStore.set(defaultPlanModeModelAtom, 'gpt-5.5');
  appStore.set(defaultPlanModeThinkingAtom, 'high');
  appStore.set(defaultExecuteModeModelAtom, 'sonnet');
  appStore.set(defaultExecuteModeThinkingAtom, 'high');
});

describe('L4 integration — Codex GPT-5.5 plan → Claude Sonnet agent (PR #52)', () => {
  test('previousProvider captured BEFORE applyDefaultModel overwrites the override atom', async () => {
    const subChatId = newSubChatId();

    // Seed a Codex plan: provider override = codex, model = gpt-5.5.
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');
    appStore.set(subChatCodexModelIdAtomFamily(subChatId), 'gpt-5.5');
    appStore.set(subChatProviderOverrideAtomFamily(subChatId), 'codex');

    let snapshotPreviousProvider: ProviderId | null = null;
    const overrideAtomReadsDuringFlow: ProviderId[] = [];

    const deps: PlanApprovalDeps = {
      readPreviousProvider: (id) => {
        // Read the atom once; this is the snapshot.
        const v = appStore.get(subChatProviderOverrideAtomFamily(id)) ?? 'claude-code';
        snapshotPreviousProvider = v;
        overrideAtomReadsDuringFlow.push(v);
        return v;
      },
      setMode: (id, mode) => {
        appStore.set(subChatModeAtomFamily(id), mode);
      },
      persistMode: async () => {},
      applyDefaultModel: (id, mode) => {
        const result = applyModeDefaultModel(id, mode);
        // Right AFTER applyDefaultModel, the atom has been overwritten.
        overrideAtomReadsDuringFlow.push(appStore.get(subChatProviderOverrideAtomFamily(id)) ?? 'claude-code');
        return { provider: result.provider, isRemote: false };
      },
      notifyProviderChange: () => {},
      resolvePlanContent: async () => ({ content: '## Plan body', source: 'codex:PlanWrite' }),
      ensurePlanPersisted: async () => {},
      buildImplementPlanParts: (payload) => [{ type: 'text', text: payload.text }],
      isInFlight: () => false,
      markInFlight: () => {},
      releaseInFlight: () => {},
      scheduleDeferredSend: () => {}
    };

    const result = await approvePlan(subChatId, deps);

    expect(result.ok).toBe(true);
    expect(snapshotPreviousProvider).toBe('codex');
    // Sequence: snapshot read = "codex", post-applyDefaultModel read = "claude-code".
    // If the snapshot had been taken AFTER applyDefaultModel, both reads would
    // be "claude-code" and the cross-provider branch would not have triggered.
    expect(overrideAtomReadsDuringFlow).toEqual(['codex', 'claude-code']);
    expect(result.transportAction).toEqual({
      kind: 'recreate',
      provider: 'claude-code',
      isRemote: false,
      reason: 'plan-approval-cross-provider'
    });
  });

  test('notifyProviderChange fires with the new provider before plan content resolves', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');
    appStore.set(subChatProviderOverrideAtomFamily(subChatId), 'codex');

    const events: string[] = [];

    const deps: PlanApprovalDeps = {
      readPreviousProvider: () => 'codex',
      setMode: (id, mode) => {
        events.push(`setMode:${mode}`);
        appStore.set(subChatModeAtomFamily(id), mode);
      },
      persistMode: async () => {
        events.push('persistMode');
      },
      applyDefaultModel: (id, mode) => {
        events.push(`applyDefaultModel:${mode}`);
        const result = applyModeDefaultModel(id, mode);
        return { provider: result.provider, isRemote: false };
      },
      notifyProviderChange: (_, provider) => {
        events.push(`notifyProviderChange:${provider}`);
      },
      resolvePlanContent: async () => {
        events.push('resolvePlanContent');
        return { content: '## Plan body', source: 'codex:PlanWrite' };
      },
      ensurePlanPersisted: async () => {
        events.push('ensurePlanPersisted');
      },
      buildImplementPlanParts: () => [{ type: 'text', text: 'x' }],
      isInFlight: () => false,
      markInFlight: () => {},
      releaseInFlight: () => {},
      scheduleDeferredSend: () => {
        events.push('scheduleDeferredSend');
      }
    };

    await approvePlan(subChatId, deps);

    expect(events).toEqual([
      'setMode:execute',
      'applyDefaultModel:execute',
      'persistMode',
      'notifyProviderChange:claude-code',
      'resolvePlanContent',
      'ensurePlanPersisted',
      'scheduleDeferredSend'
    ]);
  });

  test('deferred send stays text-only when resolved, with no file attachment', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');
    appStore.set(subChatProviderOverrideAtomFamily(subChatId), 'codex');

    const scheduledSends: { subChatId: string; parts: unknown[] }[] = [];

    const deps: PlanApprovalDeps = {
      readPreviousProvider: () => 'codex',
      setMode: (id, mode) => appStore.set(subChatModeAtomFamily(id), mode),
      persistMode: async () => {},
      applyDefaultModel: (id, mode) => {
        const result = applyModeDefaultModel(id, mode);
        return { provider: result.provider, isRemote: false };
      },
      notifyProviderChange: () => {},
      resolvePlanContent: async () => ({ content: '## Plan from Codex GPT-5.5\n1. Step one\n2. Step two' }),
      ensurePlanPersisted: async () => {},
      buildImplementPlanParts: (payload) => [{ type: 'text', text: payload.text }],
      isInFlight: () => false,
      markInFlight: () => {},
      releaseInFlight: () => {},
      scheduleDeferredSend: (id, parts) => {
        scheduledSends.push({ subChatId: id, parts });
      }
    };

    await approvePlan(subChatId, deps);

    expect(scheduledSends).toHaveLength(1);
    expect(scheduledSends[0].parts).toEqual([{ type: 'text', text: expect.any(String) }]);
  });

  test('model atom flipped from gpt-5.5 to sonnet by approval', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');
    appStore.set(subChatCodexModelIdAtomFamily(subChatId), 'gpt-5.5');
    appStore.set(subChatProviderOverrideAtomFamily(subChatId), 'codex');

    const deps: PlanApprovalDeps = {
      readPreviousProvider: () => 'codex',
      setMode: (id, mode) => appStore.set(subChatModeAtomFamily(id), mode),
      persistMode: async () => {},
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

    await approvePlan(subChatId, deps);

    // Sonnet is now the active Claude model.
    expect(appStore.get(subChatModelIdAtomFamily(subChatId))).toBe('sonnet');
    expect(appStore.get(subChatProviderOverrideAtomFamily(subChatId))).toBe('claude-code');
    // Codex thinking atom (used to be high) is unchanged because applyDefaultModel
    // routed the agent-mode default through the Claude branch.
    expect(appStore.get(subChatClaudeThinkingAtomFamily(subChatId))).toBe('high');
    // The Codex model atom retains its plan-phase value (we don't blow it away).
    expect(appStore.get(subChatCodexModelIdAtomFamily(subChatId))).toBe('gpt-5.5');
  });
});
