/**
 * Pure state machine for the plan-approval flow in active-chat.tsx.
 *
 * Models the lifecycle of `handleApprovePlan`:
 *
 *   idle
 *     │ APPROVE_REQUESTED(subChatId, previousProvider)
 *     ▼
 *   starting
 *     │ MODE_SWITCHED
 *     ▼
 *   mode-switched
 *     │ MODEL_APPLIED(newProvider)
 *     ▼
 *   model-applied
 *     │ PLAN_CONTENT_RESOLVED(content)  ← only fires for cross-provider branch
 *     ▼
 *   ready-to-send (knows transport action + payload)
 *     │ MESSAGE_SENT
 *     ▼
 *   done
 *
 * Or at any non-idle state: FAIL → error
 *
 * **No imports from `react`, `jotai`, `@trpc/*`, or anything in `features/`.**
 *
 * The lock (single-flight per subChatId) is enforced by `idle` being the only
 * state that accepts `APPROVE_REQUESTED`. This replaces the module-scope
 * `planApproveInFlight` Set used in active-chat.tsx — same semantics, but
 * testable.
 *
 * Regression coverage:
 *   - PR #52: cross-provider plan approval no longer crashes — the machine
 *     captures `previousProvider` at `APPROVE_REQUESTED` time so it can never
 *     be lost to subsequent atom mutations.
 *   - PR #51: mode flip happens before any await — encoded as the order
 *     APPROVE_REQUESTED → MODE_SWITCHED → MODEL_APPLIED → ready.
 *   - PR #45: session clear happens during the MODE_SWITCHED transition
 *     (the caller is expected to flush DB + null sessionId before emitting it).
 *   - PR #44: same-provider approval emits `transportAction: "keep"` so
 *     in-flight TodoWrite/Task events aren't orphaned.
 *   - PR #40: `payload.kind` is determined synchronously from
 *     (previousProvider, newProvider), not captured at construction time.
 */

import type { ProviderId, TransportAction } from "./transport-lifecycle"
import { decidePlanApprovalCrossProviderRecreate } from "./transport-lifecycle"

export type ImplementPlanPayload =
  /** Same provider — text-only "Implement plan" message; SDK already has plan in session history. */
  | { kind: "text-only"; text: string }
  /** Cross provider — must re-attach plan content as a hidden file part. */
  | { kind: "with-plan-attachment"; text: string; planContent: string | null }

export type PlanApprovalState =
  | { kind: "idle" }
  | { kind: "starting"; subChatId: string; previousProvider: ProviderId }
  | { kind: "mode-switched"; subChatId: string; previousProvider: ProviderId }
  | {
      kind: "model-applied"
      subChatId: string
      previousProvider: ProviderId
      newProvider: ProviderId
      crossProvider: boolean
    }
  | {
      kind: "ready-to-send"
      subChatId: string
      newProvider: ProviderId
      transportAction: TransportAction
      payload: ImplementPlanPayload
    }
  | { kind: "sent"; subChatId: string }
  | { kind: "error"; subChatId: string; reason: string }

export type PlanApprovalEvent =
  | { type: "APPROVE_REQUESTED"; subChatId: string; previousProvider: ProviderId }
  | { type: "MODE_SWITCHED" }
  | { type: "MODEL_APPLIED"; newProvider: ProviderId; newIsRemote?: boolean }
  | { type: "PLAN_CONTENT_RESOLVED"; planContent: string | null }
  | { type: "MESSAGE_SENT" }
  | { type: "FAIL"; reason: string }
  | { type: "RESET" }

export const IMPLEMENT_PLAN_BASE_TEXT = "Implementing this plan."

export function initialPlanApprovalState(): PlanApprovalState {
  return { kind: "idle" }
}

/**
 * Pure reducer. Returns the next state, or the same state if the event is
 * invalid for the current state (no throws, no exceptions — invalid events
 * are silently ignored, which mirrors the imperative code's defensive style).
 */
export function reducePlanApproval(
  state: PlanApprovalState,
  event: PlanApprovalEvent,
): PlanApprovalState {
  // RESET and FAIL are always allowed.
  if (event.type === "RESET") return { kind: "idle" }
  if (event.type === "FAIL") {
    if (state.kind === "idle") return state
    const subChatId = "subChatId" in state ? state.subChatId : ""
    return { kind: "error", subChatId, reason: event.reason }
  }

  switch (state.kind) {
    case "idle": {
      if (event.type !== "APPROVE_REQUESTED") return state
      return {
        kind: "starting",
        subChatId: event.subChatId,
        previousProvider: event.previousProvider,
      }
    }

    case "starting": {
      if (event.type === "APPROVE_REQUESTED") {
        // Lock: re-entry on the same subChatId is a no-op (PR #52 guard).
        return state
      }
      if (event.type !== "MODE_SWITCHED") return state
      return {
        kind: "mode-switched",
        subChatId: state.subChatId,
        previousProvider: state.previousProvider,
      }
    }

    case "mode-switched": {
      if (event.type !== "MODEL_APPLIED") return state
      const crossProvider = event.newProvider !== state.previousProvider
      const nextState: PlanApprovalState = {
        kind: "model-applied",
        subChatId: state.subChatId,
        previousProvider: state.previousProvider,
        newProvider: event.newProvider,
        crossProvider,
      }
      // Same provider: no plan content needed; jump straight to ready-to-send.
      if (!crossProvider) {
        return toReadyToSend(nextState, null, !!event.newIsRemote)
      }
      return nextState
    }

    case "model-applied": {
      if (event.type !== "PLAN_CONTENT_RESOLVED") return state
      // model-applied is only reached for the cross-provider branch (the
      // same-provider branch jumps to ready-to-send in the previous case).
      return toReadyToSend(state, event.planContent, false)
    }

    case "ready-to-send": {
      if (event.type !== "MESSAGE_SENT") return state
      return { kind: "sent", subChatId: state.subChatId }
    }

    case "sent":
    case "error":
      return state
  }
}

function toReadyToSend(
  state: Extract<PlanApprovalState, { kind: "model-applied" }>,
  planContent: string | null,
  newIsRemote: boolean,
): PlanApprovalState {
  const transportAction = decidePlanApprovalCrossProviderRecreate({
    previousProvider: state.previousProvider,
    newProvider: state.newProvider,
    newIsRemote,
  })

  const payload: ImplementPlanPayload = state.crossProvider
    ? { kind: "with-plan-attachment", text: IMPLEMENT_PLAN_BASE_TEXT, planContent }
    : { kind: "text-only", text: IMPLEMENT_PLAN_BASE_TEXT }

  return {
    kind: "ready-to-send",
    subChatId: state.subChatId,
    newProvider: state.newProvider,
    transportAction,
    payload,
  }
}

/**
 * Convenience: replay a sequence of events on top of an initial state.
 */
export function runPlanApproval(
  initial: PlanApprovalState,
  events: ReadonlyArray<PlanApprovalEvent>,
): PlanApprovalState {
  return events.reduce(reducePlanApproval, initial)
}

/**
 * Single-flight check used by callers to decide whether to drop a duplicate
 * `APPROVE_REQUESTED` event (e.g., two ChatViewInner mounts firing the same
 * pendingBuildPlanSubChatIdAtom write at once — the bug fixed by PR #51's
 * isActive guard).
 */
export function isInFlight(state: PlanApprovalState): boolean {
  return state.kind !== "idle" && state.kind !== "sent" && state.kind !== "error"
}
