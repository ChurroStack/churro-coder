/**
 * Plan-approval orchestrator service.
 *
 * Wraps `handleApprovePlan` from `active-chat.tsx` (the body of the
 * `useEffect` consuming `pendingBuildPlanSubChatIdAtom` calls into here).
 * The service composes the pure FSM in `machines/plan-approval-machine.ts`
 * with injected side-effect deps so the orchestration is testable end-to-end
 * without touching React, Jotai, or tRPC.
 *
 * **Layering rule**: this file may import from `machines/` but NOT from
 * `react`, `jotai`, `@trpc/*`, or `features/agents/main/`. Side effects are
 * passed in via {@link PlanApprovalDeps} so each test can inject mocks.
 *
 * Regression invariants encoded here (reference comments call out PR numbers):
 *
 *   1. **PR #36** — `applyDefaultModel` MUST run synchronously before any
 *      `await`. The orchestrator captures the resolved provider from the
 *      synchronous return value and only then awaits the DB persist.
 *
 *   2. **PR #38** — every mode switch must propagate the configured per-mode
 *      default model + thinking. Encoded by always calling `applyDefaultModel`
 *      after `setMode`, regardless of provider branch.
 *
 *   3. **PR #40** — `previousProvider` is captured BEFORE any state writes,
 *      because `applyDefaultModel` overwrites the provider override atom as
 *      a side effect. The service reads it via `readPreviousProvider` exactly
 *      once at the top of the flow, then passes it through the FSM.
 *
 *   4. **PR #44** — same-provider approvals (Claude→Claude, Codex→Codex)
 *      KEEP the existing transport so in-flight TodoWrite/Task tool events
 *      aren't orphaned. Encoded in the FSM's `MODEL_APPLIED` branch and
 *      surfaced to the caller via `result.transportAction.kind === "keep"`.
 *
 *   5. **PR #45** — DB persist nulls `sessionId` + `sessionMode` (the
 *      `exitPlan: true` flag). The service awaits this BEFORE scheduling the
 *      deferred send so a stale session can't be resumed.
 *
 *   6. **PR #51** — single-flight per subChatId. Two ChatViewInner mounts
 *      (legacy layout + dock panel) racing on the same `pendingBuildPlanSubChatIdAtom`
 *      write would crash the renderer. The service consults `isInFlight`
 *      synchronously at entry and returns `{ ok: false, reason: "in-flight" }`
 *      on re-entry without performing any writes.
 *
 *   7. **PR #52** — cross-provider approvals (Codex GPT-5.5 → Claude Sonnet,
 *      etc.) recreate the transport AFTER the model atom is written, so the
 *      new transport reads the right model. Encoded in the FSM's
 *      `decidePlanApprovalCrossProviderRecreate`.
 */

import {
  IMPLEMENT_PLAN_BASE_TEXT,
  initialPlanApprovalState,
  isInFlight as machineIsInFlight,
  reducePlanApproval,
  type ImplementPlanPayload,
  type PlanApprovalEvent,
  type PlanApprovalState
} from '../machines/plan-approval-machine';
import type { ProviderId, TransportAction } from '../machines/transport-lifecycle';

/** Optional logger; defaults to no-op so tests can assert on stdout cleanliness. */
export type LogFn = (msg: string) => void;

export interface ApprovedPlanContent {
  content: string;
  source?: string;
  title?: string;
}

export interface PlanApprovalDeps {
  /**
   * Read the planner's provider BEFORE any state writes. The renderer
   * wires this to `(existingChat?.transport instanceof CodexChatTransport) ? "codex" : "claude-code"`,
   * falling back to `appStore.get(subChatProviderOverridesAtom)[subChatId]`.
   */
  readPreviousProvider: (subChatId: string) => ProviderId;

  /**
   * Synchronous mode flip — writes `subChatModeAtomFamily(subChatId)` AND
   * `subChatModesStorageAtom` AND the Zustand `useAgentSubChatStore`.
   * Must NOT await internally; the contract is "all visible UI flips by the
   * time this returns".
   */
  setMode: (subChatId: string, mode: 'execute' | 'plan') => void;

  /**
   * Async DB persist. Wraps `api.agents.updateSubChatMode.useMutation` with
   * `exitPlan: true` so the server clears `sessionId` + `sessionMode`.
   * The service awaits this BEFORE scheduling the deferred send (PR #45).
   *
   * Implementations may choose to skip the call for `subChatId.startsWith("temp-")`
   * to mirror the renderer's optimistic-create flow; that decision lives in
   * the caller, not the service.
   */
  persistMode: (input: { subChatId: string; mode: 'execute'; exitPlan: true }) => Promise<void>;

  /**
   * Bump the renderer-side session reset markers after plan approval has
   * forced the next execute turn to start fresh.
   */
  resetSessionTracking?: (subChatId: string) => void;

  /**
   * Synchronous wrapper around `applyModeDefaultModel(subChatId, "execute")`.
   * Returns the resolved provider so the FSM can decide same/cross-provider
   * branching. **MUST run before any await** — invariant from PR #36.
   */
  applyDefaultModel: (subChatId: string, mode: 'execute') => { provider: ProviderId; isRemote: boolean };

  /**
   * Cross-provider only: notifies the renderer that the transport should be
   * recreated for the new provider. The renderer wires this to
   * `setSubChatProviderOverrides(prev => ({...prev, [subChatId]: nextProvider}))`,
   * which forces `getOrCreateChat` to tear down + rebuild on the next read.
   */
  notifyProviderChange: (subChatId: string, provider: ProviderId) => void;

  /**
   * Async — resolves the plan content from messages or the `virtualPlanContent`
   * atom. Returns `null` if the plan can't be recovered (best-effort; the
   * cross-provider branch still proceeds with `planContent: null`).
   */
  resolvePlanContent: () => Promise<ApprovedPlanContent | null>;

  ensurePlanPersisted: (input: { subChatId: string; plan: ApprovedPlanContent }) => Promise<void>;

  /**
   * Build the AI SDK message parts array for the implement-plan send.
   */
  buildImplementPlanParts: (payload: ImplementPlanPayload) => unknown[];

  /**
   * Single-flight check. Wraps the module-level `planApproveInFlight: Set<string>`
   * in `active-chat.tsx`. The service reads this synchronously on entry; if true,
   * it short-circuits with `{ ok: false, reason: "in-flight" }` without any writes.
   */
  isInFlight: (subChatId: string) => boolean;

  /** Add `subChatId` to the in-flight set. Called immediately after the lock check. */
  markInFlight: (subChatId: string) => void;

  /**
   * Remove `subChatId` from the in-flight set. Called in the service's
   * `finally` block so the lock is released even on throw.
   */
  releaseInFlight: (subChatId: string) => void;

  /**
   * Schedule the deferred send via the renderer's `setPendingImplementPlan`
   * React state. The renderer's effect at `active-chat.tsx:3596` consumes
   * this and calls `sendMessage` once `isStreaming === false`.
   */
  scheduleDeferredSend: (subChatId: string, parts: unknown[]) => void;

  /** Optional structured logger (defaults to no-op). */
  log?: LogFn;
}

export interface PlanApprovalResult {
  /** True if the flow ran to `ready-to-send` and dispatched. */
  ok: boolean;
  /** Final FSM state — useful for assertions and follow-up logic. */
  finalState: PlanApprovalState;
  /** Set when ok is false — one of: "in-flight" | "no-deps" | "persist-failed" | "send-failed" */
  reason?: string;
  /** The transport action the orchestrator decided on (KEEP for same-provider, RECREATE for cross). */
  transportAction?: TransportAction;
}

/**
 * Run the plan-approval flow for `subChatId`.
 *
 * The service is async because it awaits the DB persist + plan-content resolution.
 * Synchronous side effects (`setMode`, `applyDefaultModel`, `notifyProviderChange`)
 * happen in the precise order the FSM dictates — see {@link reducePlanApproval}.
 *
 * **Why pass deps explicitly?** Two reasons:
 *   1. The L2 tests inject mocks for every dep, so we can verify the call
 *      order without spinning up React/Jotai/tRPC.
 *   2. The renderer's `active-chat.tsx` will eventually call into here,
 *      and the deps wire-up makes the seam explicit. No more hidden module-level
 *      reads of `appStore`/`agentChatStore` in the orchestration path.
 *
 * @returns A {@link PlanApprovalResult} describing what happened.
 */
export async function approvePlan(subChatId: string, deps: PlanApprovalDeps): Promise<PlanApprovalResult> {
  const log = deps.log ?? (() => {});

  // 1. Single-flight guard (PR #51). MUST be the first check — re-entry
  //    on the same subChatId from a second mount would otherwise race the
  //    cross-provider transport teardown.
  if (deps.isInFlight(subChatId)) {
    log(`[PLAN] approve:reentry sub=${subChatId.slice(-8)} skipped (in-flight)`);
    return { ok: false, finalState: { kind: 'idle' }, reason: 'in-flight' };
  }
  deps.markInFlight(subChatId);

  let state: PlanApprovalState = initialPlanApprovalState();

  try {
    // 2. Capture previousProvider BEFORE any state writes (PR #40, #52).
    //    `applyDefaultModel` overwrites the provider override atom, so we
    //    snapshot the planner's provider here exactly once.
    const previousProvider = deps.readPreviousProvider(subChatId);
    log(`[PLAN] approve:start sub=${subChatId.slice(-8)} previousProvider=${previousProvider}`);

    state = step(state, { type: 'APPROVE_REQUESTED', subChatId, previousProvider });

    // 3. Synchronous mode flip + Zustand store sync (PR #36, #38, #51).
    //    setMode writes `subChatModesStorageAtom`, which the dbSubChats
    //    hydration loop in active-chat.tsx checks before letting a stale
    //    refetch overwrite the mode atom back to "plan".
    deps.setMode(subChatId, 'execute');

    state = step(state, { type: 'MODE_SWITCHED' });

    // 4. Apply mode-default model SYNCHRONOUSLY before any await (PR #36, #38).
    //    The transport reads `subChatModelIdAtomFamily(subChatId)` at send-time;
    //    yielding the event loop before this write means the next message goes
    //    out with the previous mode's model.
    const { provider: newProvider, isRemote: newIsRemote } = deps.applyDefaultModel(subChatId, 'execute');
    log(
      `[PLAN] approve:model-applied sub=${subChatId.slice(-8)} ` +
        `newProvider=${newProvider} crossProvider=${previousProvider !== newProvider}`
    );

    state = step(state, {
      type: 'MODEL_APPLIED',
      newProvider,
      newIsRemote
    });

    // 5. Persist mode to DB with exitPlan: true (PR #45). Awaited so the
    //    DB write lands BEFORE the deferred send schedules — otherwise the
    //    server might resume the plan-mode session for the implement-plan turn.
    //    The caller decides whether to skip for temp- IDs; we just await.
    try {
      await deps.persistMode({ subChatId, mode: 'execute', exitPlan: true });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log(`[PLAN] approve:persist-failed sub=${subChatId.slice(-8)} ${reason}`);
      state = reducePlanApproval(state, { type: 'FAIL', reason });
      return { ok: false, finalState: state, reason: 'persist-failed' };
    }
    deps.resetSessionTracking?.(subChatId);

    // 6. Same-provider branch (PR #44): the FSM has already transitioned
    //    to ready-to-send during MODEL_APPLIED for same-provider; we don't
    //    need to await plan content. Schedule the deferred send and return.
    if (state.kind === 'ready-to-send') {
      let plan: ApprovedPlanContent | null = null;
      try {
        plan = await deps.resolvePlanContent();
      } catch (err) {
        log(
          `[PLAN] approve:plan-resolve-warn sub=${subChatId.slice(-8)} ` +
            `${err instanceof Error ? err.message : String(err)}`
        );
      }
      if (plan) {
        await deps.ensurePlanPersisted({ subChatId, plan });
      } else {
        log(`[PLAN] approve:plan-persist-skip sub=${subChatId.slice(-8)} reason=no-plan-content`);
      }

      const parts = deps.buildImplementPlanParts(state.payload);
      deps.scheduleDeferredSend(subChatId, parts);
      state = step(state, { type: 'MESSAGE_SENT' });
      return {
        ok: true,
        finalState: state,
        transportAction: { kind: 'keep' }
      };
    }

    // 7. Cross-provider branch (PR #52): recreate the transport, then await
    //    plan content (best-effort; null is fine), then schedule the deferred
    //    send with the plan attached as a hidden file part.
    if (state.kind === 'model-applied') {
      // notifyProviderChange triggers the renderer's setSubChatProviderOverrides,
      // which forces getOrCreateChat to tear down + rebuild on the next read.
      // Order matters: this happens AFTER applyDefaultModel (so the new model
      // is already in the atom) but BEFORE the deferred send schedules.
      deps.notifyProviderChange(subChatId, newProvider);

      let plan: ApprovedPlanContent | null = null;
      try {
        plan = await deps.resolvePlanContent();
      } catch (err) {
        log(
          `[PLAN] approve:plan-resolve-warn sub=${subChatId.slice(-8)} ` +
            `${err instanceof Error ? err.message : String(err)}`
        );
      }

      if (plan) {
        await deps.ensurePlanPersisted({ subChatId, plan });
      } else {
        log(`[PLAN] approve:plan-persist-skip sub=${subChatId.slice(-8)} reason=no-plan-content`);
      }

      state = step(state, { type: 'PLAN_CONTENT_RESOLVED', planContent: plan?.content ?? null });

      if (state.kind !== 'ready-to-send') {
        // Defensive: PLAN_CONTENT_RESOLVED from model-applied always reaches
        // ready-to-send. If it doesn't, treat as bug.
        const reason = `unexpected-state:${state.kind}`;
        log(`[PLAN] approve:bug sub=${subChatId.slice(-8)} ${reason}`);
        return { ok: false, finalState: state, reason };
      }

      const parts = deps.buildImplementPlanParts(state.payload);
      deps.scheduleDeferredSend(subChatId, parts);
      state = step(state, { type: 'MESSAGE_SENT' });

      return {
        ok: true,
        finalState: state,
        transportAction: {
          kind: 'recreate',
          provider: newProvider,
          isRemote: newIsRemote,
          reason: 'plan-approval-cross-provider'
        }
      };
    }

    // Unreachable in normal flow (FSM has no other branches at this point).
    return { ok: false, finalState: state, reason: `unexpected-state:${state.kind}` };
  } finally {
    // Single-flight release happens regardless of throw (PR #51).
    deps.releaseInFlight(subChatId);
  }
}

/**
 * Re-export of the FSM helper. Callers using the in-flight Set in
 * `active-chat.tsx` can compute the lock state from the FSM as well.
 */
export { machineIsInFlight, IMPLEMENT_PLAN_BASE_TEXT };

function step(state: PlanApprovalState, event: PlanApprovalEvent): PlanApprovalState {
  return reducePlanApproval(state, event);
}
