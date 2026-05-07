import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  forceMode,
  hydrateMode,
  initialState,
  noteSendRequested,
  noteStreamCompleted,
  noteStreamStarted,
  toggleMode,
  type ModeSwitchDeps
} from './mode-switch-service';
import type { ChatModeState } from '../machines/chat-mode-machine';
import type { ProviderId } from '../machines/transport-lifecycle';

/**
 * L2 tests for mode-switch-service.
 *
 * Encodes invariants from PR #36, #38, #51. Each `describe` is tagged to the
 * PR it guards against.
 */

interface CallRecord {
  order: number;
  fn: string;
  args?: unknown;
}

function makeDeps(
  initialMode: 'plan' | 'execute' | 'review' = 'plan',
  overrides: Partial<ModeSwitchDeps> = {}
): {
  deps: ModeSwitchDeps;
  calls: CallRecord[];
  states: Map<string, ChatModeState>;
} {
  const calls: CallRecord[] = [];
  const states = new Map<string, ChatModeState>();
  let counter = 0;
  const record = (fn: string, args?: unknown) => calls.push({ order: ++counter, fn, args });

  const deps: ModeSwitchDeps = {
    readState: vi.fn((subChatId: string) => {
      record('readState', { subChatId });
      return states.get(subChatId) ?? initialState(initialMode);
    }),
    writeState: vi.fn((subChatId: string, state: ChatModeState) => {
      record('writeState', { subChatId, mode: state.mode, activity: state.activity });
      states.set(subChatId, state);
    }),
    setMode: vi.fn((subChatId: string, mode: 'plan' | 'execute' | 'review') => {
      record('setMode', { subChatId, mode });
    }),
    applyDefaultModel: vi.fn((subChatId: string, mode) => {
      record('applyDefaultModel', { subChatId, mode });
      return { modelId: 'sonnet', provider: 'claude-code' as ProviderId };
    }),
    persistMode: vi.fn(async (input) => {
      record('persistMode', input);
    }),
    log: () => {},
    ...overrides
  };
  return { deps, calls, states };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('toggleMode — happy path call ordering (PR #36)', () => {
  test('plan → agent: setMode → applyDefaultModel → persistMode (sync writes BEFORE await)', async () => {
    const { deps, calls } = makeDeps('plan');
    const result = await toggleMode('sub-1', 'execute', deps);

    const order = calls.filter((c) => c.fn !== 'readState' && c.fn !== 'writeState').map((c) => c.fn);
    expect(order).toEqual(['setMode', 'applyDefaultModel', 'persistMode']);
    expect(result.ok).toBe(true);
    expect(result.finalState.mode).toBe('execute');
  });

  test('setMode and applyDefaultModel resolve before persistMode is awaited', async () => {
    // Container ref — see chat-send-service.test.ts for the rationale (TS
    // can't narrow `let` assignments inside async Promise callbacks).
    const resolver: { fn: (() => void) | null } = { fn: null };
    const persistDone = new Promise<void>((res) => {
      resolver.fn = res;
    });

    const { deps, calls } = makeDeps('plan', {
      persistMode: vi.fn(async () => {
        calls.push({ order: -1, fn: 'persistMode-enter' });
        await persistDone;
        calls.push({ order: -1, fn: 'persistMode-exit' });
      })
    });

    const flow = toggleMode('sub-1', 'execute', deps);
    await new Promise((r) => setTimeout(r, 0));

    const fns = calls.map((c) => c.fn);
    expect(fns).toContain('setMode');
    expect(fns).toContain('applyDefaultModel');
    expect(fns).toContain('persistMode-enter');
    expect(fns).not.toContain('persistMode-exit');

    resolver.fn?.();
    await flow;
  });
});

describe('toggleMode — rejected mid-stream (FSM rule)', () => {
  test('toggle rejected when activity=streaming, no writes performed', async () => {
    const { deps } = makeDeps('plan');
    // Bump activity to streaming first.
    noteSendRequested('sub-1', deps);
    noteStreamStarted('sub-1', deps);

    vi.clearAllMocks(); // reset call counters; only count what happens during toggle

    const result = await toggleMode('sub-1', 'execute', deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('busy');
    expect(deps.setMode).not.toHaveBeenCalled();
    expect(deps.applyDefaultModel).not.toHaveBeenCalled();
    expect(deps.persistMode).not.toHaveBeenCalled();
  });

  test('toggle accepted again after STREAM_COMPLETED', async () => {
    const { deps } = makeDeps('plan');
    noteSendRequested('sub-1', deps);
    noteStreamStarted('sub-1', deps);
    // First toggle rejected
    expect((await toggleMode('sub-1', 'execute', deps)).ok).toBe(false);

    noteStreamCompleted('sub-1', deps);
    const result = await toggleMode('sub-1', 'execute', deps);
    expect(result.ok).toBe(true);
  });
});

describe('toggleMode — no-op when already in target mode', () => {
  test('plan → plan returns ok:false reason:no-change without writes', async () => {
    const { deps } = makeDeps('plan');
    const result = await toggleMode('sub-1', 'plan', deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-change');
    expect(deps.setMode).not.toHaveBeenCalled();
    expect(deps.applyDefaultModel).not.toHaveBeenCalled();
  });
});

describe('toggleMode — applyDefaultModel always called (PR #38)', () => {
  test("plan → agent triggers applyDefaultModel('execute')", async () => {
    const { deps } = makeDeps('plan');
    await toggleMode('sub-1', 'execute', deps);
    expect(deps.applyDefaultModel).toHaveBeenCalledWith('sub-1', 'execute');
  });

  test("agent → plan triggers applyDefaultModel('plan')", async () => {
    const { deps } = makeDeps('execute');
    await toggleMode('sub-1', 'plan', deps);
    expect(deps.applyDefaultModel).toHaveBeenCalledWith('sub-1', 'plan');
  });

  test("toggle to review triggers applyDefaultModel('review')", async () => {
    const { deps } = makeDeps('execute');
    await toggleMode('sub-1', 'review', deps);
    expect(deps.applyDefaultModel).toHaveBeenCalledWith('sub-1', 'review');
  });
});

describe('toggleMode — provider change notification', () => {
  test('notifyProviderChange fires when wired', async () => {
    const notifyProviderChange = vi.fn();
    const { deps } = makeDeps('plan', {
      notifyProviderChange,
      applyDefaultModel: vi.fn((_id: string, _mode: 'plan' | 'execute' | 'review') => ({
        modelId: 'gpt-5.4',
        provider: 'codex' as ProviderId
      }))
    });
    const result = await toggleMode('sub-1', 'execute', deps);
    expect(notifyProviderChange).toHaveBeenCalledWith('sub-1', 'codex');
    expect(result.crossProvider).toBe(true);
  });

  test("crossProvider is false when notifyProviderChange isn't wired", async () => {
    const { deps } = makeDeps('plan', { notifyProviderChange: undefined });
    const result = await toggleMode('sub-1', 'execute', deps);
    expect(result.crossProvider).toBe(false);
  });
});

describe('forceMode — bypasses activity gate', () => {
  test('force agent during streaming still applies (used by plan approval)', async () => {
    const { deps } = makeDeps('plan');
    noteSendRequested('sub-1', deps);
    noteStreamStarted('sub-1', deps);

    const result = await forceMode('sub-1', 'execute', 'plan-approved', deps);
    expect(result.ok).toBe(true);
    expect(deps.setMode).toHaveBeenCalledWith('sub-1', 'execute');
    expect(deps.applyDefaultModel).toHaveBeenCalledWith('sub-1', 'execute');
  });

  test('force to same mode still bumps hydrationVersion (defensive against stale HYDRATE)', async () => {
    const { deps, states } = makeDeps('execute');
    const before = states.get('sub-1') ?? initialState('execute');
    await forceMode('sub-1', 'execute', 'session-resumed', deps);
    const after = states.get('sub-1');
    expect(after?.hydrationVersion).toBeGreaterThan(before.hydrationVersion);
  });

  test('force to same mode does NOT call applyDefaultModel (no-op semantics)', async () => {
    const { deps } = makeDeps('execute');
    await forceMode('sub-1', 'execute', 'session-resumed', deps);
    expect(deps.applyDefaultModel).not.toHaveBeenCalled();
  });
});

describe('hydrateMode — stale refetch race (PR #51)', () => {
  test('hydrate with current version applies', () => {
    const { deps, states } = makeDeps('execute');
    const before = states.get('sub-1') ?? initialState('execute');
    const result = hydrateMode('sub-1', 'plan', before.hydrationVersion + 1, deps);
    expect(result.applied).toBe(true);
    expect(result.finalState.mode).toBe('plan');
  });

  test('hydrate with stale version is REJECTED — no setMode call', () => {
    const { deps, states } = makeDeps('plan');
    // First, simulate a forced flip plan → agent (e.g., handleApprovePlan).
    states.set('sub-1', {
      mode: 'execute',
      activity: 'idle',
      hydrationVersion: 5,
      mustApplyDefaults: false
    });

    vi.clearAllMocks();

    // Now a stale DB refetch arrives with hydrationVersion=4 trying to set mode back to plan.
    const result = hydrateMode('sub-1', 'plan', 4, deps);
    expect(result.applied).toBe(false);
    expect(deps.setMode).not.toHaveBeenCalled();
    expect(states.get('sub-1')?.mode).toBe('execute');
  });

  test('hydrate with same mode + newer version still syncs the external mode atom', () => {
    const { deps, states } = makeDeps('plan');
    states.set('sub-1', {
      mode: 'plan',
      activity: 'idle',
      hydrationVersion: 1,
      mustApplyDefaults: false
    });
    vi.clearAllMocks();

    const result = hydrateMode('sub-1', 'plan', 5, deps);
    // applied=true because state changed (version increased). setMode still
    // runs because the external mode atom may be stale independently of the FSM.
    expect(result.finalState.hydrationVersion).toBe(5);
    expect(deps.setMode).toHaveBeenCalledWith('sub-1', 'plan');
  });

  test('hydrate agent over initial agent still syncs stale persisted localStorage', () => {
    const { deps, states } = makeDeps('execute');
    const before = states.get('sub-1') ?? initialState('execute');

    const result = hydrateMode('sub-1', 'execute', before.hydrationVersion + 1, deps);

    expect(result.applied).toBe(true);
    expect(result.finalState.mode).toBe('execute');
    expect(deps.setMode).toHaveBeenCalledWith('sub-1', 'execute');
    expect(deps.applyDefaultModel).not.toHaveBeenCalled();
  });
});

describe('toggleMode — failure: persistMode rejects', () => {
  test('returns ok:false reason:persist-failed; FSM state still reflects new mode', async () => {
    const { deps } = makeDeps('plan', {
      persistMode: vi.fn(async () => {
        throw new Error('offline');
      })
    });
    const result = await toggleMode('sub-1', 'execute', deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('persist-failed');
    expect(result.finalState.mode).toBe('execute'); // setMode already ran
    expect(deps.setMode).toHaveBeenCalledWith('sub-1', 'execute');
  });
});

describe('event-stream passthroughs', () => {
  test('noteStreamStarted advances activity to streaming', () => {
    const { deps } = makeDeps('execute');
    noteSendRequested('sub-1', deps);
    const after = noteStreamStarted('sub-1', deps);
    expect(after.activity).toBe('streaming');
  });

  test('noteStreamCompleted returns activity to idle', () => {
    const { deps } = makeDeps('execute');
    noteSendRequested('sub-1', deps);
    noteStreamStarted('sub-1', deps);
    const after = noteStreamCompleted('sub-1', deps);
    expect(after.activity).toBe('idle');
  });
});
