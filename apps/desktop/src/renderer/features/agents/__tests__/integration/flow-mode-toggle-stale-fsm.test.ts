/**
 * L4 integration: toggleMode reconciles when the FSM mode lags behind the
 * DB-backed UI mode (the "selector see lazy nebula" bug).
 *
 * Failure mode reproduced here:
 *   - The FSM atom defaults to `mode: 'execute'` in
 *     `chatModeFsmStateAtomFamily`.
 *   - The chat-level `dbSubChats` hydration loop calls `hydrateMode` once
 *     `getAgentChat` resolves, but the per-sub-chat `getSubChat` query
 *     (which the dropdown reads via `useSubChatMode`) often resolves
 *     first.
 *   - Until hydration runs, the FSM holds `'execute'` while the dropdown
 *     shows the persisted `'plan'`. Clicking Execute against the FSM's
 *     stale value is silently rejected as `no-change`.
 *
 * Plan→Explore→Execute works because `'execute' !== 'explore'`, accepts
 * the toggle, and re-aligns the FSM. Direct Plan→Execute hits the
 * no-change short-circuit and goes nowhere.
 *
 * The fix: `toggleMode` accepts an optional `currentMode` (the dropdown's
 * value) and reconciles the FSM mode against it before the no-change
 * comparison.
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
  defaultPlanModeModelAtom,
  subChatModelIdAtomFamily,
  type AgentMode
} from '../../atoms';
import { applyModeDefaultModel } from '../../lib/model-switching';
import { initialState, toggleMode, type ModeSwitchDeps } from '../../services/mode-switch-service';
import type { ChatModeState } from '../../machines/chat-mode-machine';

let testCounter = 0;
const newSubChatId = () => `int-stale-fsm-${++testCounter}`;

beforeEach(() => {
  appStore.set(defaultPlanModeModelAtom, 'opus[1m]');
  appStore.set(defaultExecuteModeModelAtom, 'sonnet');
});

function makeDeps(subChatId: string, fsmInitialMode: 'plan' | 'execute' | 'explore' | 'review') {
  const states = new Map<string, ChatModeState>([[subChatId, initialState(fsmInitialMode)]]);
  // The DB-backed mode that the dropdown displays. The renderer reads
  // this from `useSubChatMode` (tRPC `chats.getSubChat`); here we model
  // it as a plain Map so the `setMode` dep can write through.
  const dbModeMap = new Map<string, AgentMode>();

  const deps: ModeSwitchDeps = {
    readState: (id) => states.get(id) ?? initialState(fsmInitialMode),
    writeState: (id, state) => {
      states.set(id, state);
    },
    setMode: (id, mode) => {
      if (mode === 'review') return;
      dbModeMap.set(id, mode as AgentMode);
    },
    applyDefaultModel: (id, mode) => {
      const r = applyModeDefaultModel(id, mode);
      return { modelId: r.modelId, provider: r.provider };
    },
    persistMode: async () => {}
  };

  return { deps, states, dbModeMap };
}

describe("L4 integration — toggleMode reconciles FSM lag (the 'selector see lazy nebula' bug)", () => {
  test('FSM=execute (atom default), UI/DB=plan, click Execute: toggle accepted, mode flips to execute', async () => {
    const subChatId = newSubChatId();
    // Seed the dropdown's source of truth: DB has 'plan'.
    const { deps, dbModeMap, states } = makeDeps(subChatId, 'execute');
    dbModeMap.set(subChatId, 'plan');

    // User clicks Execute. The dropdown shows 'plan' (currentMode), the
    // FSM still holds its 'execute' default because hydration hasn't run.
    const result = await toggleMode(subChatId, 'execute', deps, { currentMode: 'plan' });

    expect(result.ok).toBe(true);
    expect(result.finalState.mode).toBe('execute');
    expect(dbModeMap.get(subChatId)).toBe('execute');
    // Plan→Execute also applies the execute-mode default model (PR #38).
    expect(appStore.get(subChatModelIdAtomFamily(subChatId))).toBe('sonnet');
    // FSM state was reconciled — its written `mode` reflects the flip.
    expect(states.get(subChatId)!.mode).toBe('execute');
  });

  test('FSM=execute, UI/DB=plan, click Plan: still no-change (user clicks current displayed mode)', async () => {
    const subChatId = newSubChatId();
    const { deps, dbModeMap } = makeDeps(subChatId, 'execute');
    dbModeMap.set(subChatId, 'plan');

    const result = await toggleMode(subChatId, 'plan', deps, { currentMode: 'plan' });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-change');
    // DB unchanged — user picked the mode they were already on.
    expect(dbModeMap.get(subChatId)).toBe('plan');
  });

  test('without currentMode opt: legacy callers still hit the no-change short-circuit', async () => {
    // Regression contract: the new option is purely additive. Any caller
    // that omits `currentMode` keeps the pre-fix behavior — the FSM's
    // own (potentially-stale) mode is used for the no-change comparison.
    const subChatId = newSubChatId();
    const { deps, dbModeMap } = makeDeps(subChatId, 'execute');
    // No DB mode pre-set — legacy callers don't drive `setMode` on a
    // rejected toggle, so we expect dbModeMap to remain empty.

    const result = await toggleMode(subChatId, 'execute', deps);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-change');
    expect(dbModeMap.get(subChatId)).toBeUndefined();
  });

  test('FSM=plan and UI/DB=plan agree: click Execute commits as plan→execute', async () => {
    // Steady-state happy path — FSM and DB are aligned. currentMode is
    // redundant but must not break the toggle.
    const subChatId = newSubChatId();
    const { deps, dbModeMap, states } = makeDeps(subChatId, 'plan');
    dbModeMap.set(subChatId, 'plan');

    const result = await toggleMode(subChatId, 'execute', deps, { currentMode: 'plan' });

    expect(result.ok).toBe(true);
    expect(result.finalState.mode).toBe('execute');
    expect(dbModeMap.get(subChatId)).toBe('execute');
    expect(states.get(subChatId)!.mode).toBe('execute');
  });

  test('Plan→Explore→Execute pre-fix workaround still works after the fix', async () => {
    // Validates that the workaround documented in the bug report
    // continues to function after the reconciliation lands.
    const subChatId = newSubChatId();
    const { deps, dbModeMap } = makeDeps(subChatId, 'execute');
    dbModeMap.set(subChatId, 'plan');

    const r1 = await toggleMode(subChatId, 'explore', deps, { currentMode: 'plan' });
    expect(r1.ok).toBe(true);
    expect(dbModeMap.get(subChatId)).toBe('explore');

    const r2 = await toggleMode(subChatId, 'execute', deps, { currentMode: 'explore' });
    expect(r2.ok).toBe(true);
    expect(dbModeMap.get(subChatId)).toBe('execute');
  });
});
