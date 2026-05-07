import { describe, test, expect, vi, beforeEach } from 'vitest';
import { approvePlan, type PlanApprovalDeps } from './plan-approval-service';
import { IMPLEMENT_PLAN_BASE_TEXT } from '../machines/plan-approval-machine';
import type { ProviderId } from '../machines/transport-lifecycle';

/**
 * L2 tests for plan-approval-service.
 *
 * These tests exist to lock in the bug-cluster invariants from
 * PRs #36 / #38 / #40 / #44 / #45 / #51 / #52. Each `describe` block names
 * the PR(s) it guards against — that mapping is the audit trail. Adding a
 * new test? Tag it to a PR (or the repro for a future bug) so the
 * regression coverage stays searchable.
 *
 * Test strategy: every dep is a `vi.fn()` mock so the service runs end-to-end
 * with no React, Jotai, or tRPC. The interesting assertions are CALL ORDER
 * (e.g. setMode before applyDefaultModel before persistMode) — that's where
 * the imperative code in active-chat.tsx kept regressing.
 */

interface CallOrderRecord {
  /** Sequential index of the call across ALL deps, used for ordering assertions. */
  order: number;
  fn: string;
  args?: unknown;
}

function makeDeps(overrides: Partial<PlanApprovalDeps> = {}): {
  deps: PlanApprovalDeps;
  /** Append-only call log across every dep, in invocation order. */
  calls: CallOrderRecord[];
  inFlight: Set<string>;
} {
  const calls: CallOrderRecord[] = [];
  const inFlight = new Set<string>();
  let counter = 0;
  const record = (fn: string, args?: unknown) => {
    calls.push({ order: ++counter, fn, args });
  };

  const deps: PlanApprovalDeps = {
    readPreviousProvider: vi.fn((subChatId: string) => {
      record('readPreviousProvider', { subChatId });
      return 'claude-code' as ProviderId;
    }),
    setMode: vi.fn((subChatId: string, mode: 'execute' | 'plan') => {
      record('setMode', { subChatId, mode });
    }),
    persistMode: vi.fn(async (input) => {
      record('persistMode', input);
    }),
    applyDefaultModel: vi.fn((subChatId: string, mode: 'execute') => {
      record('applyDefaultModel', { subChatId, mode });
      return { provider: 'claude-code' as ProviderId, isRemote: false };
    }),
    notifyProviderChange: vi.fn((subChatId: string, provider: ProviderId) => {
      record('notifyProviderChange', { subChatId, provider });
    }),
    resolvePlanContent: vi.fn(async () => {
      record('resolvePlanContent');
      return null;
    }),
    ensurePlanPersisted: vi.fn(async ({ subChatId, plan }) => {
      record('ensurePlanPersisted', { subChatId, plan });
    }),
    buildImplementPlanParts: vi.fn((payload) => {
      record('buildImplementPlanParts', { payloadKind: payload.kind });
      return [{ type: 'text', text: payload.text }];
    }),
    isInFlight: vi.fn((subChatId: string) => inFlight.has(subChatId)),
    markInFlight: vi.fn((subChatId: string) => {
      record('markInFlight', { subChatId });
      inFlight.add(subChatId);
    }),
    releaseInFlight: vi.fn((subChatId: string) => {
      record('releaseInFlight', { subChatId });
      inFlight.delete(subChatId);
    }),
    scheduleDeferredSend: vi.fn((subChatId: string, parts: unknown[]) => {
      record('scheduleDeferredSend', { subChatId, partsLen: parts.length });
    }),
    log: () => {},
    ...overrides
  };
  return { deps, calls, inFlight };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('approvePlan — happy path call ordering', () => {
  test('same-provider Claude→Claude: setMode → applyDefaultModel → persistMode → schedule (PR #36 ordering)', async () => {
    const { deps, calls } = makeDeps();
    const result = await approvePlan('sub-1', deps);

    const order = calls.map((c) => c.fn);
    expect(order).toEqual([
      'markInFlight',
      'readPreviousProvider',
      'setMode',
      'applyDefaultModel',
      'persistMode',
      'resolvePlanContent',
      'buildImplementPlanParts',
      'scheduleDeferredSend',
      'releaseInFlight'
    ]);
    expect(result.ok).toBe(true);
    expect(result.transportAction).toEqual({ kind: 'keep' });
    expect(result.finalState.kind).toBe('sent');
  });

  test("same-provider Codex→Codex: ditto, KEEP transport (PR #44 — don't orphan TodoWrite/Task)", async () => {
    const { deps } = makeDeps({
      readPreviousProvider: vi.fn((_id: string): ProviderId => 'codex'),
      applyDefaultModel: vi.fn((_id: string, _mode: 'execute') => ({
        provider: 'codex' as ProviderId,
        isRemote: false
      }))
    });
    const result = await approvePlan('sub-1', deps);
    expect(result.ok).toBe(true);
    expect(result.transportAction).toEqual({ kind: 'keep' });
    expect(deps.notifyProviderChange).not.toHaveBeenCalled();
  });

  test('buildImplementPlanParts is called with unified payload for same-provider', async () => {
    const { deps } = makeDeps();
    await approvePlan('sub-1', deps);
    expect(deps.buildImplementPlanParts).toHaveBeenCalledWith({
      kind: 'implement-plan',
      text: IMPLEMENT_PLAN_BASE_TEXT,
      subChatId: 'sub-1'
    });
  });
});

describe('approvePlan — cross-provider (PR #52)', () => {
  test('Claude→Codex: notifyProviderChange fires, plan content resolved, RECREATE returned', async () => {
    const { deps } = makeDeps({
      readPreviousProvider: vi.fn((_id: string): ProviderId => 'claude-code'),
      applyDefaultModel: vi.fn((_id: string, _mode: 'execute') => ({
        provider: 'codex' as ProviderId,
        isRemote: false
      })),
      resolvePlanContent: vi.fn(async () => ({ content: '## Plan\n1. Step', source: 'claude:ExitPlanMode' }))
    });
    const result = await approvePlan('sub-1', deps);

    // Critical ordering: applyDefaultModel BEFORE notifyProviderChange BEFORE resolvePlanContent.
    // Use vi.fn().mock.invocationCallOrder which is independent of how the test wires `record`.
    const applyOrder = (deps.applyDefaultModel as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const notifyOrder = (deps.notifyProviderChange as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const resolveOrder = (deps.resolvePlanContent as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(applyOrder).toBeLessThan(notifyOrder);
    expect(notifyOrder).toBeLessThan(resolveOrder);

    expect(result.ok).toBe(true);
    expect(result.transportAction).toEqual({
      kind: 'recreate',
      provider: 'codex',
      isRemote: false,
      reason: 'plan-approval-cross-provider'
    });
  });

  test('Codex GPT-5.5 → Claude Sonnet — PR #52 specific scenario', async () => {
    const { deps } = makeDeps({
      readPreviousProvider: vi.fn((_id: string): ProviderId => 'codex'),
      applyDefaultModel: vi.fn((_id: string, _mode: 'execute') => ({
        provider: 'claude-code' as ProviderId,
        isRemote: false
      })),
      resolvePlanContent: vi.fn(async () => ({ content: '## Plan from Codex', source: 'codex:PlanWrite' }))
    });
    const result = await approvePlan('sub-1', deps);
    expect(result.ok).toBe(true);
    expect(result.transportAction?.kind).toBe('recreate');
    if (result.transportAction?.kind === 'recreate') {
      expect(result.transportAction.provider).toBe('claude-code');
    }
  });

  test('buildImplementPlanParts called with unified payload for cross-provider', async () => {
    const { deps } = makeDeps({
      applyDefaultModel: vi.fn((_id: string, _mode: 'execute') => ({
        provider: 'codex' as ProviderId,
        isRemote: false
      })),
      resolvePlanContent: vi.fn(async () => ({ content: 'plan body', source: 'codex:PlanWrite' }))
    });
    await approvePlan('sub-1', deps);
    expect(deps.buildImplementPlanParts).toHaveBeenCalledWith({
      kind: 'implement-plan',
      text: IMPLEMENT_PLAN_BASE_TEXT,
      subChatId: 'sub-1'
    });
  });

  test('cross-provider proceeds even when plan content fails to resolve', async () => {
    const { deps } = makeDeps({
      applyDefaultModel: vi.fn((_id: string, _mode: 'execute') => ({
        provider: 'codex' as ProviderId,
        isRemote: false
      })),
      resolvePlanContent: vi.fn(async () => {
        throw new Error('plan file gone');
      })
    });
    const result = await approvePlan('sub-1', deps);
    expect(result.ok).toBe(true);
    expect(deps.buildImplementPlanParts).toHaveBeenCalledWith({
      kind: 'implement-plan',
      text: IMPLEMENT_PLAN_BASE_TEXT,
      subChatId: 'sub-1'
    });
  });

  test('cross-provider preserves isRemote flag through to transportAction', async () => {
    const { deps } = makeDeps({
      applyDefaultModel: vi.fn((_id: string, _mode: 'execute') => ({ provider: 'codex' as ProviderId, isRemote: true }))
    });
    const result = await approvePlan('sub-1', deps);
    expect(result.transportAction).toMatchObject({ kind: 'recreate', isRemote: true });
  });
});

describe('approvePlan — invariant: previousProvider captured before any state writes (PR #40)', () => {
  test('readPreviousProvider runs BEFORE setMode and applyDefaultModel', async () => {
    const { deps, calls } = makeDeps();
    await approvePlan('sub-1', deps);

    const order = calls.map((c) => c.fn);
    const prev = order.indexOf('readPreviousProvider');
    const set = order.indexOf('setMode');
    const apply = order.indexOf('applyDefaultModel');

    expect(prev).toBeGreaterThanOrEqual(0);
    expect(prev).toBeLessThan(set);
    expect(prev).toBeLessThan(apply);
  });

  test('readPreviousProvider invoked exactly once (snapshot semantics)', async () => {
    const { deps } = makeDeps();
    await approvePlan('sub-1', deps);
    expect(deps.readPreviousProvider).toHaveBeenCalledTimes(1);
  });
});

describe('approvePlan — invariant: applyDefaultModel BEFORE await persistMode (PR #36)', () => {
  test('applyDefaultModel resolves before the persistMode promise is awaited', async () => {
    const resolver: { fn: (() => void) | null } = { fn: null };
    const persistPromise = new Promise<void>((res) => {
      resolver.fn = res;
    });

    const { deps, calls } = makeDeps({
      persistMode: vi.fn(async (input) => {
        // Block on this resolver so we can assert applyDefaultModel already ran.
        calls.push({ order: -1, fn: 'persistMode-enter', args: input });
        await persistPromise;
        calls.push({ order: -1, fn: 'persistMode-exit', args: input });
      })
    });

    const flow = approvePlan('sub-1', deps);

    // Yield a microtask so the synchronous prefix of the service runs.
    await new Promise((r) => setTimeout(r, 0));

    const fnsBeforeAwait = calls.map((c) => c.fn);
    expect(fnsBeforeAwait).toContain('setMode');
    expect(fnsBeforeAwait).toContain('applyDefaultModel');
    expect(fnsBeforeAwait).toContain('persistMode-enter');
    expect(fnsBeforeAwait).not.toContain('persistMode-exit');

    resolver.fn?.();
    await flow;
  });
});

describe('approvePlan — single-flight (PR #51)', () => {
  test('re-entry on the same subChatId returns ok:false without writes', async () => {
    const { deps, inFlight } = makeDeps();
    inFlight.add('sub-1'); // pretend a previous call is still running

    const result = await approvePlan('sub-1', deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('in-flight');
    expect(deps.setMode).not.toHaveBeenCalled();
    expect(deps.applyDefaultModel).not.toHaveBeenCalled();
    expect(deps.persistMode).not.toHaveBeenCalled();
    expect(deps.scheduleDeferredSend).not.toHaveBeenCalled();
  });

  test('releaseInFlight runs in finally even when persistMode throws', async () => {
    const { deps } = makeDeps({
      persistMode: vi.fn(async () => {
        throw new Error('DB down');
      })
    });

    const result = await approvePlan('sub-1', deps);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('persist-failed');
    expect(deps.releaseInFlight).toHaveBeenCalledTimes(1);
    expect(deps.releaseInFlight).toHaveBeenCalledWith('sub-1');
  });

  test('two parallel approvePlan calls on the same subChatId — second one short-circuits', async () => {
    const { deps } = makeDeps({
      // Hold persistMode open so the first call is mid-flight.
      persistMode: vi.fn(async () => new Promise<void>((r) => setTimeout(r, 50)))
    });

    const first = approvePlan('sub-1', deps);
    // Await a tick so markInFlight has run.
    await new Promise((r) => setTimeout(r, 0));
    const second = await approvePlan('sub-1', deps);

    expect(second.ok).toBe(false);
    expect(second.reason).toBe('in-flight');

    // markInFlight + releaseInFlight on the first; markInFlight on the second is NOT called.
    expect(deps.markInFlight).toHaveBeenCalledTimes(1);

    await first;
  });
});

describe('approvePlan — DB persist with exitPlan: true (PR #45)', () => {
  test("persistMode is called with mode: 'execute' and exitPlan: true", async () => {
    const { deps } = makeDeps();
    await approvePlan('sub-1', deps);
    expect(deps.persistMode).toHaveBeenCalledWith({
      subChatId: 'sub-1',
      mode: 'execute',
      exitPlan: true
    });
  });

  test('ensurePlanPersisted is awaited after persistMode and before scheduleDeferredSend', async () => {
    const events: string[] = [];
    const { deps } = makeDeps({
      resolvePlanContent: vi.fn(async () => {
        events.push('resolvePlanContent');
        return { content: '## Plan\n1. Step' };
      }),
      ensurePlanPersisted: vi.fn(async () => {
        events.push('ensurePlanPersisted');
      }),
      scheduleDeferredSend: vi.fn(() => {
        events.push('scheduleDeferredSend');
      })
    });

    await approvePlan('sub-1', deps);
    expect(events).toEqual(['resolvePlanContent', 'ensurePlanPersisted', 'scheduleDeferredSend']);
  });

  test('persistMode is awaited BEFORE scheduleDeferredSend (PR #45 — no stale session resume)', async () => {
    const resolver: { fn: (() => void) | null } = { fn: null };
    let persistResolved = false;
    const { deps, calls } = makeDeps({
      persistMode: vi.fn(async () => {
        await new Promise<void>((res) => {
          resolver.fn = () => {
            persistResolved = true;
            res();
          };
        });
      })
    });

    const flow = approvePlan('sub-1', deps);
    await new Promise((r) => setTimeout(r, 0));

    expect(persistResolved).toBe(false);
    expect(deps.scheduleDeferredSend).not.toHaveBeenCalled();

    resolver.fn?.();
    await flow;

    expect(persistResolved).toBe(true);
    expect(deps.scheduleDeferredSend).toHaveBeenCalledTimes(1);
    // Order: persistMode appears in calls BEFORE scheduleDeferredSend.
    const order = calls.map((c) => c.fn);
    expect(order.indexOf('persistMode')).toBeLessThan(order.indexOf('scheduleDeferredSend'));
  });

  test('persistMode failure → no scheduleDeferredSend, ok=false, lock released', async () => {
    const { deps } = makeDeps({
      persistMode: vi.fn(async () => {
        throw new Error('persist failed');
      })
    });
    const result = await approvePlan('sub-1', deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('persist-failed');
    expect(deps.scheduleDeferredSend).not.toHaveBeenCalled();
    expect(deps.releaseInFlight).toHaveBeenCalledWith('sub-1');
  });
});

describe('approvePlan — same-provider transport KEEP (PR #44)', () => {
  test('notifyProviderChange is NOT called for Claude→Claude', async () => {
    const { deps } = makeDeps();
    await approvePlan('sub-1', deps);
    expect(deps.notifyProviderChange).not.toHaveBeenCalled();
  });

  test('notifyProviderChange is NOT called for Codex→Codex', async () => {
    const { deps } = makeDeps({
      readPreviousProvider: vi.fn((_id: string): ProviderId => 'codex'),
      applyDefaultModel: vi.fn((_id: string, _mode: 'execute') => ({
        provider: 'codex' as ProviderId,
        isRemote: false
      }))
    });
    await approvePlan('sub-1', deps);
    expect(deps.notifyProviderChange).not.toHaveBeenCalled();
  });

  test('resolvePlanContent is called for same-provider so fallback persistence can run', async () => {
    const { deps } = makeDeps();
    await approvePlan('sub-1', deps);
    expect(deps.resolvePlanContent).toHaveBeenCalledTimes(1);
  });
});

describe('approvePlan — invariant: setMode before applyDefaultModel (PR #38)', () => {
  test("setMode called with 'execute' BEFORE applyDefaultModel('execute')", async () => {
    const { deps, calls } = makeDeps();
    await approvePlan('sub-1', deps);
    const order = calls.map((c) => c.fn);
    expect(order.indexOf('setMode')).toBeLessThan(order.indexOf('applyDefaultModel'));
  });

  test("setMode receives mode='execute' (not 'plan' or anything else)", async () => {
    const { deps } = makeDeps();
    await approvePlan('sub-1', deps);
    expect(deps.setMode).toHaveBeenCalledWith('sub-1', 'execute');
  });
});

describe('approvePlan — failure modes return structured results', () => {
  test('returns ok:false reason:in-flight without throwing on lock conflict', async () => {
    const { deps, inFlight } = makeDeps();
    inFlight.add('sub-1');
    const result = await approvePlan('sub-1', deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('in-flight');
  });

  test('persist failure does NOT crash; lock is released', async () => {
    const { deps, inFlight } = makeDeps({
      persistMode: vi.fn(async () => {
        throw new Error('network');
      })
    });
    const result = await approvePlan('sub-1', deps);
    expect(result.ok).toBe(false);
    expect(inFlight.has('sub-1')).toBe(false);
  });
});
