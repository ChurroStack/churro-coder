/**
 * L4 integration: form binding when a new sub-chat is created (PR #38).
 *
 * The bug class:
 *   When a user creates a new sub-chat (or toggles mode on an existing
 *   one), the chat-input "form" — model badge + thinking dropdown +
 *   provider chip — must immediately reflect the **per-mode default**
 *   the user configured in Settings. Pre-PR #38 the renderer applied
 *   the default model only on plan-approval, leaving user-toggled
 *   sub-chats showing the previous mode's model until the next refresh.
 *
 * What we're guarding against (regression scenarios from the PR thread):
 *
 *   1. Toggling plan → agent on a fresh sub-chat must flip the chat-input
 *      model to `defaultExecuteModeModelAtom`. Same for thinking.
 *   2. Toggling agent → plan must flip to `defaultPlanModeModelAtom`.
 *   3. The mode flip and model write must both land **synchronously**
 *      before any `await` (PR #36) so the chat-input UI shows the new
 *      model on the very next render, not after a tick.
 *   4. Cross-provider defaults: if the user's plan-mode default is a
 *      Codex model, toggling into plan mode flips the provider override
 *      AND sets the Codex model atom (not the Claude one).
 *   5. Per-subChatId isolation: toggling mode on sub-A must not bleed
 *      into sub-B's form bindings (PR #51-style isolation guard).
 *
 * Drives the **real** `applyModeDefaultModel` from `lib/model-switching`
 * via the **real** `mode-switch-service.toggleMode` — the only mocks are
 * the deps that perform side effects outside the model/atom pipeline
 * (persistMode, notifyProviderChange).
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
import { toggleMode, type ModeSwitchDeps } from '../../services/mode-switch-service';
import { initialChatModeState, type ChatModeState } from '../../machines/chat-mode-machine';
import type { ProviderId } from '../../machines/transport-lifecycle';

let testCounter = 0;
const newSubChatId = () => `int-form-${++testCounter}`;

beforeEach(() => {
  // Reset per-mode defaults to a known baseline. Each test that needs
  // different defaults overrides these.
  appStore.set(defaultPlanModeModelAtom, 'opus[1m]');
  appStore.set(defaultExecuteModeModelAtom, 'sonnet');
  appStore.set(defaultPlanModeThinkingAtom, 'high');
  appStore.set(defaultExecuteModeThinkingAtom, 'high');
});

interface OrchestrationResult {
  setModeCalls: { subChatId: string; mode: string }[];
  persistCalls: { subChatId: string; mode: string }[];
  notifyCalls: { subChatId: string; provider: ProviderId }[];
  applyOrder: string[];
}

function makeDeps(initialMode: 'plan' | 'execute' = 'plan'): {
  deps: ModeSwitchDeps;
  orchestration: OrchestrationResult;
  states: Map<string, ChatModeState>;
} {
  const states = new Map<string, ChatModeState>();
  const orchestration: OrchestrationResult = {
    setModeCalls: [],
    persistCalls: [],
    notifyCalls: [],
    applyOrder: []
  };

  const deps: ModeSwitchDeps = {
    readState: (id) => states.get(id) ?? initialChatModeState(initialMode),
    writeState: (id, state) => {
      states.set(id, state);
    },
    setMode: (id, mode) => {
      orchestration.applyOrder.push('setMode');
      orchestration.setModeCalls.push({ subChatId: id, mode });
      // Mirror the renderer's setMode: write atom + storage atom. We
      // skip the Zustand store mirror here — the integration test
      // observes via the atom directly.
      if (mode === 'review') return;
      appStore.set(subChatModeAtomFamily(id), mode);
    },
    applyDefaultModel: (id, mode) => {
      orchestration.applyOrder.push('applyDefaultModel');
      // Use the REAL applyModeDefaultModel — that's the integration
      // boundary. It writes the model + thinking atoms based on the
      // configured per-mode defaults and returns the resolved provider.
      const result = applyModeDefaultModel(id, mode);
      return {
        modelId: result.modelId,
        provider: result.provider as ProviderId
      };
    },
    persistMode: async (input) => {
      orchestration.applyOrder.push('persistMode');
      orchestration.persistCalls.push(input);
    },
    notifyProviderChange: (id, provider) => {
      orchestration.notifyCalls.push({ subChatId: id, provider });
    }
  };

  return { deps, orchestration, states };
}

describe('L4 form-binding — toggle plan → agent applies agent-mode default model', () => {
  test('PR #38: agent default = sonnet propagates to subChatModelIdAtomFamily on toggle', async () => {
    const subChatId = newSubChatId();
    // Fresh sub-chat in plan mode with the plan default model.
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');
    appStore.set(subChatModelIdAtomFamily(subChatId), 'opus[1m]');
    appStore.set(subChatClaudeThinkingAtomFamily(subChatId), 'high');

    const { deps, orchestration } = makeDeps('plan');
    const result = await toggleMode(subChatId, 'execute', deps);

    expect(result.ok).toBe(true);
    // Mode atom flipped.
    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('execute');
    // Model atom now reflects the configured AGENT-mode default.
    expect(appStore.get(subChatModelIdAtomFamily(subChatId))).toBe('sonnet');
    // Thinking propagated.
    expect(appStore.get(subChatClaudeThinkingAtomFamily(subChatId))).toBe('high');
    // Persist was called once with the new mode.
    expect(orchestration.persistCalls).toEqual([{ subChatId, mode: 'execute' }]);
  });

  test('PR #38: agent default = haiku propagates correctly when user reconfigured', async () => {
    appStore.set(defaultExecuteModeModelAtom, 'haiku');
    appStore.set(defaultExecuteModeThinkingAtom, 'none');

    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');
    appStore.set(subChatModelIdAtomFamily(subChatId), 'opus[1m]');

    const { deps } = makeDeps('plan');
    await toggleMode(subChatId, 'execute', deps);

    expect(appStore.get(subChatModelIdAtomFamily(subChatId))).toBe('haiku');
    expect(appStore.get(subChatClaudeThinkingAtomFamily(subChatId))).toBe('none');
  });
});

describe('L4 form-binding — toggle agent → plan applies plan-mode default model', () => {
  test('PR #38: plan default = opus[1m] propagates to subChatModelIdAtomFamily on toggle', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'execute');
    appStore.set(subChatModelIdAtomFamily(subChatId), 'sonnet');

    const { deps } = makeDeps('execute');
    const result = await toggleMode(subChatId, 'plan', deps);

    expect(result.ok).toBe(true);
    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('plan');
    expect(appStore.get(subChatModelIdAtomFamily(subChatId))).toBe('opus[1m]');
  });
});

describe('L4 form-binding — sync ordering (PR #36)', () => {
  test('setMode + applyDefaultModel run BEFORE the persist await resolves', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');

    const { deps, orchestration } = makeDeps('plan');
    // Hold persist open so we can observe the ordering before it resolves.
    let resolver: (() => void) | null = null;
    deps.persistMode = async (input) => {
      orchestration.applyOrder.push('persistMode');
      orchestration.persistCalls.push(input);
      await new Promise<void>((res) => {
        resolver = res;
      });
    };

    const promise = toggleMode(subChatId, 'execute', deps);
    // Yield once so persistMode starts.
    await new Promise((r) => setTimeout(r, 0));

    // BEFORE persist resolves, both the mode atom and the model atom
    // must already reflect the new mode. This is the guarantee the
    // chat-input form binding relies on (PR #36).
    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('execute');
    expect(appStore.get(subChatModelIdAtomFamily(subChatId))).toBe('sonnet');
    // setMode + applyDefaultModel ran before persistMode.
    expect(orchestration.applyOrder.slice(0, 2)).toEqual(['setMode', 'applyDefaultModel']);

    resolver?.();
    await promise;
  });
});

describe('L4 form-binding — cross-provider defaults', () => {
  test('plan default = Codex model: toggle to plan flips provider + Codex model atom', async () => {
    appStore.set(defaultPlanModeModelAtom, 'gpt-5.5');
    appStore.set(defaultPlanModeThinkingAtom, 'medium');

    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'execute');
    appStore.set(subChatModelIdAtomFamily(subChatId), 'sonnet');

    const { deps } = makeDeps('execute');
    const result = await toggleMode(subChatId, 'plan', deps);

    expect(result.ok).toBe(true);
    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('plan');
    // Provider override flipped to codex (real applyModeDefaultModel
    // sets `subChatProviderOverrideAtomFamily` as a side effect).
    expect(appStore.get(subChatProviderOverrideAtomFamily(subChatId))).toBe('codex');
    // The Codex model atom (not the Claude one) now holds the default.
    expect(appStore.get(subChatCodexModelIdAtomFamily(subChatId))).toBe('gpt-5.5');
    expect(appStore.get(subChatCodexThinkingAtomFamily(subChatId))).toBe('medium');
  });
});

describe('L4 form-binding — per-subChatId isolation (PR #51 class)', () => {
  test("toggling mode on sub-A does not bleed into sub-B's model atom", async () => {
    appStore.set(defaultExecuteModeModelAtom, 'sonnet');
    appStore.set(defaultPlanModeModelAtom, 'opus[1m]');

    const subA = newSubChatId();
    const subB = newSubChatId();

    // sub-A is plan with opus, sub-B is agent with haiku (a non-default
    // value to detect bleed).
    appStore.set(subChatModeAtomFamily(subA), 'plan');
    appStore.set(subChatModelIdAtomFamily(subA), 'opus[1m]');
    appStore.set(subChatModeAtomFamily(subB), 'execute');
    appStore.set(subChatModelIdAtomFamily(subB), 'haiku');

    const { deps } = makeDeps('plan');
    const result = await toggleMode(subA, 'execute', deps);

    expect(result.ok).toBe(true);
    // sub-A flipped.
    expect(appStore.get(subChatModeAtomFamily(subA))).toBe('execute');
    expect(appStore.get(subChatModelIdAtomFamily(subA))).toBe('sonnet');
    // sub-B is untouched — the toggle on sub-A must NOT have rewritten
    // sub-B's model. (Pre-PR #51 a shared module-level state could
    // bleed; per-subChatId atom families guard against this.)
    expect(appStore.get(subChatModeAtomFamily(subB))).toBe('execute');
    expect(appStore.get(subChatModelIdAtomFamily(subB))).toBe('haiku');
  });
});

describe('L4 form-binding — fresh-mount hydration applies defaults consistently', () => {
  test('hydrate from persisted mode: applyDefaultModel runs once with that mode', async () => {
    const subChatId = newSubChatId();
    // Simulate a sub-chat that was persisted in the DB with mode=plan and
    // re-loaded on a fresh mount. Pre-hydration the renderer atom is at
    // its default (agent); the FSM hydration must flip both the mode
    // atom AND propagate the per-mode default model.
    appStore.set(subChatModeAtomFamily(subChatId), 'execute');
    appStore.set(subChatModelIdAtomFamily(subChatId), 'sonnet');

    const { hydrateMode } = await import('../../services/mode-switch-service');
    const { deps, orchestration } = makeDeps('execute');

    const result = hydrateMode(subChatId, 'plan', 1, deps);

    expect(result.applied).toBe(true);
    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('plan');
    // Plan-mode default propagated by the hydration.
    expect(appStore.get(subChatModelIdAtomFamily(subChatId))).toBe('opus[1m]');
    // Hydration calls setMode + applyDefaultModel; persist is NOT called
    // (hydration is a read from the persisted state, not a write back).
    expect(orchestration.applyOrder.filter((op) => op !== 'persistMode')).toEqual(['setMode', 'applyDefaultModel']);
    expect(orchestration.persistCalls).toEqual([]);
  });
});
