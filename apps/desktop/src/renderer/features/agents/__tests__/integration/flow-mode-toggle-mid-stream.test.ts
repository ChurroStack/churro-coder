/**
 * L4 integration: mode toggle is rejected mid-stream, accepted after completion.
 *
 * The chat-mode FSM rejects USER_TOGGLED_MODE while activity != idle. This
 * test wires the FSM through the mode-switch service with the real
 * applyModeDefaultModel and verifies:
 *   - Toggle during streaming → no atom writes, no model switch.
 *   - Toggle after STREAM_COMPLETED → atoms flip + model switches.
 *
 * Reproduces the failure mode where rapid Shift-Tab during a long-running
 * agent turn would intermittently leave the chat input + transport in
 * inconsistent states.
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
  subChatModeAtomFamily,
  subChatModelIdAtomFamily
} from '../../atoms';
import { applyModeDefaultModel } from '../../lib/model-switching';
import {
  initialState,
  noteSendRequested,
  noteStreamCompleted,
  noteStreamStarted,
  toggleMode,
  type ModeSwitchDeps
} from '../../services/mode-switch-service';
import type { ChatModeState } from '../../machines/chat-mode-machine';

let testCounter = 0;
const newSubChatId = () => `int-toggle-${++testCounter}`;

beforeEach(() => {
  appStore.set(defaultPlanModeModelAtom, 'opus[1m]');
  appStore.set(defaultExecuteModeModelAtom, 'sonnet');
});

function makeDeps(subChatId: string): {
  deps: ModeSwitchDeps;
  states: Map<string, ChatModeState>;
} {
  const states = new Map<string, ChatModeState>([[subChatId, initialState('execute')]]);

  const deps: ModeSwitchDeps = {
    readState: (id) => states.get(id) ?? initialState('execute'),
    writeState: (id, state) => {
      states.set(id, state);
    },
    setMode: (id, mode) => {
      // ChatMode is "plan" | "execute" | "review"; the persisted atom only
      // accepts AgentMode ("plan" | "execute"). Review is transient and
      // never reaches setMode in toggleMode flows.
      if (mode === 'review') return;
      appStore.set(subChatModeAtomFamily(id), mode);
    },
    applyDefaultModel: (id, mode) => {
      const result = applyModeDefaultModel(id, mode);
      return { modelId: result.modelId, provider: result.provider };
    },
    persistMode: async () => {}
  };

  return { deps, states };
}

describe('L4 integration — mode toggle mid-stream is rejected', () => {
  test('agent → plan toggle during streaming: no atom writes', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'execute');
    appStore.set(subChatModelIdAtomFamily(subChatId), 'sonnet');

    const { deps } = makeDeps(subChatId);

    // Simulate streaming: SEND_REQUESTED → STREAM_STARTED.
    noteSendRequested(subChatId, deps);
    noteStreamStarted(subChatId, deps);

    const result = await toggleMode(subChatId, 'plan', deps);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('busy');
    // Atom did not flip.
    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('execute');
    // Model atom did not change to opus[1m].
    expect(appStore.get(subChatModelIdAtomFamily(subChatId))).toBe('sonnet');
  });

  test('agent → plan toggle after STREAM_COMPLETED: atoms flip', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'execute');
    appStore.set(subChatModelIdAtomFamily(subChatId), 'sonnet');

    const { deps } = makeDeps(subChatId);

    // Stream lifecycle: send → start → complete.
    noteSendRequested(subChatId, deps);
    noteStreamStarted(subChatId, deps);
    noteStreamCompleted(subChatId, deps);

    const result = await toggleMode(subChatId, 'plan', deps);

    expect(result.ok).toBe(true);
    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('plan');
    // Plan-mode default applied.
    expect(appStore.get(subChatModelIdAtomFamily(subChatId))).toBe('opus[1m]');
  });

  test('rapid toggle: 5 toggles during streaming all rejected, atoms unchanged', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'execute');

    const { deps } = makeDeps(subChatId);
    noteSendRequested(subChatId, deps);
    noteStreamStarted(subChatId, deps);

    for (let i = 0; i < 5; i++) {
      const target = i % 2 === 0 ? 'plan' : 'execute';
      const result = await toggleMode(subChatId, target, deps);
      expect(result.ok).toBe(false);
    }
    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('execute');
  });

  test('toggle accepted between consecutive turns (complete → toggle → send → complete)', async () => {
    const subChatId = newSubChatId();
    appStore.set(subChatModeAtomFamily(subChatId), 'execute');

    const { deps } = makeDeps(subChatId);

    // Turn 1.
    noteSendRequested(subChatId, deps);
    noteStreamStarted(subChatId, deps);
    noteStreamCompleted(subChatId, deps);

    // User toggles to plan between turns — accepted.
    const r1 = await toggleMode(subChatId, 'plan', deps);
    expect(r1.ok).toBe(true);
    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('plan');

    // Turn 2 in plan mode.
    noteSendRequested(subChatId, deps);
    noteStreamStarted(subChatId, deps);

    // Toggle attempted mid-stream — rejected.
    const r2 = await toggleMode(subChatId, 'execute', deps);
    expect(r2.ok).toBe(false);
    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('plan');

    // Stream completes.
    noteStreamCompleted(subChatId, deps);

    // Now accepted.
    const r3 = await toggleMode(subChatId, 'execute', deps);
    expect(r3.ok).toBe(true);
    expect(appStore.get(subChatModeAtomFamily(subChatId))).toBe('execute');
  });
});
