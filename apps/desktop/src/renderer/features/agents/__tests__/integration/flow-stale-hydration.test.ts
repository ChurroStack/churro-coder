/**
 * L4 integration: stale DB hydration after a forced flip (PR #51).
 *
 * Reproduces the failure mode where:
 *   1. User approves a plan → handleApprovePlan force-flips mode plan→agent.
 *   2. The plan-mode session's tRPC refetch fires AFTER the flip.
 *   3. Without the hydrationVersion guard, the refetch's HYDRATE event would
 *      reset the mode atom back to "plan" — the visible bug from PR #51.
 *
 * The integration test simulates this race: a sequence of FORCE_MODE then
 * a stale HYDRATE with an older version. The mode atom must end on "agent",
 * setMode must NOT have been called for the hydration, and the FSM's
 * hydrationVersion must reflect the forced flip.
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
  defaultPlanModeModelAtom,
  subChatModeAtomFamily,
  subChatModelIdAtomFamily
} from '../../atoms';
import { applyModeDefaultModel } from '../../lib/model-switching';
import { forceMode, hydrateMode, initialState, type ModeSwitchDeps } from '../../services/mode-switch-service';
import type { ChatModeState } from '../../machines/chat-mode-machine';

let testCounter = 0;
const newSubChatId = () => `int-stale-${++testCounter}`;

beforeEach(() => {
  appStore.set(defaultPlanModeModelAtom, 'opus[1m]');
  appStore.set(defaultAgentModeModelAtom, 'sonnet');
});

function makeDeps(
  subChatId: string,
  initialMode: 'plan' | 'agent' = 'plan'
): {
  deps: ModeSwitchDeps;
  states: Map<string, ChatModeState>;
  setModeCalls: { subChatId: string; mode: string }[];
} {
  const states = new Map<string, ChatModeState>([[subChatId, initialState(initialMode)]]);
  const setModeCalls: { subChatId: string; mode: string }[] = [];

  const deps: ModeSwitchDeps = {
    readState: (id) => states.get(id) ?? initialState(initialMode),
    writeState: (id, state) => {
      states.set(id, state);
    },
    setMode: (id, mode) => {
      setModeCalls.push({ subChatId: id, mode });
      // ChatMode → AgentMode narrowing (review is transient, never persisted).
      if (mode === 'review') return;
      appStore.set(subChatModeAtomFamily(id), mode);
    },
    applyDefaultModel: (id, mode) => {
      const result = applyModeDefaultModel(id, mode);
      return { modelId: result.modelId, provider: result.provider };
    },
    persistMode: async () => {}
  };

  return { deps, states, setModeCalls };
}

describe('L4 integration — stale DB hydration race (PR #51)', () => {
  test('forced flip then stale hydrate: mode atom stays on agent', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'plan');
    const { deps, states, setModeCalls } = makeDeps(subChatId, 'plan');

    // 1. handleApprovePlan calls forceMode("agent", "plan-approved").
    await forceMode(subChatId, 'agent', 'plan-approved', deps);

    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('agent');
    const versionAfterFlip = states.get(subChatId)!.hydrationVersion;

    // 2. A stale DB refetch arrives reporting mode="plan" with a hydrationVersion
    //    that's strictly less than the forced-flip version. The renderer's
    //    dbSubChats hydration loop forwards this as a HYDRATE event.
    const setModeCallsBefore = setModeCalls.length;
    const result = hydrateMode(subChatId, 'plan', versionAfterFlip - 1, deps);

    // Hydrate is rejected by the FSM (stale version).
    expect(result.applied).toBe(false);
    // setMode was NOT called for the hydrate.
    expect(setModeCalls.length).toBe(setModeCallsBefore);
    // Mode atom still "agent".
    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('agent');
  });

  test('forced flip then NEWER hydrate with same mode: silent version bump, no setMode', async () => {
    const subChatId = newSubChatId();
    const { deps, states, setModeCalls } = makeDeps(subChatId, 'plan');

    await forceMode(subChatId, 'agent', 'plan-approved', deps);
    const versionAfterFlip = states.get(subChatId)!.hydrationVersion;

    setModeCalls.length = 0; // reset

    // DB refetch reports the same mode (agent) with a newer version (e.g. server
    // already saw the exitPlan write from PR #45 and bumped its own version).
    const result = hydrateMode(subChatId, 'agent', versionAfterFlip + 5, deps);

    expect(states.get(subChatId)!.hydrationVersion).toBe(versionAfterFlip + 5);
    expect(setModeCalls.length).toBe(0);
    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('agent');
  });

  test('forced flip then NEWER hydrate with DIFFERENT mode: applies + setMode + applyDefaultModel', async () => {
    const subChatId = newSubChatId();
    const { deps, states, setModeCalls } = makeDeps(subChatId, 'plan');

    await forceMode(subChatId, 'agent', 'plan-approved', deps);
    const versionAfterFlip = states.get(subChatId)!.hydrationVersion;

    setModeCalls.length = 0;

    // Newer hydrate with mode=plan would apply (intentional rollback from
    // server). This is a real scenario: another client toggled the mode,
    // server published the change, our client must accept.
    const result = hydrateMode(subChatId, 'plan', versionAfterFlip + 1, deps);

    expect(result.applied).toBe(true);
    expect(setModeCalls).toEqual([{ subChatId, mode: 'plan' }]);
    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('plan');
    // Plan-mode default applied.
    expect(appStore.get(subChatModelIdAtomFamily(subChatId))).toBe('opus[1m]');
  });

  test('two stale hydrations followed by one current: only the current applies', async () => {
    const subChatId = newSubChatId();
    const { deps, states, setModeCalls } = makeDeps(subChatId, 'plan');

    await forceMode(subChatId, 'agent', 'plan-approved', deps);
    const versionAfterFlip = states.get(subChatId)!.hydrationVersion;

    setModeCalls.length = 0;

    expect(hydrateMode(subChatId, 'plan', versionAfterFlip - 2, deps).applied).toBe(false);
    expect(hydrateMode(subChatId, 'plan', versionAfterFlip - 1, deps).applied).toBe(false);

    expect(setModeCalls).toEqual([]);
    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('agent');

    // Now a current-version hydrate that agrees with the FSM: silent bump,
    // no setMode.
    const result = hydrateMode(subChatId, 'agent', versionAfterFlip + 1, deps);
    expect(result.applied).toBe(true);
    expect(setModeCalls).toEqual([]);
    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('agent');
  });
});
