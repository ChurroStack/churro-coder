/**
 * Pure state machine for the chat-mode lifecycle in active-chat.tsx.
 *
 * Models the interaction between:
 *   - the persisted mode (plan / agent / review)
 *   - the streaming activity (idle / sending / streaming / errored)
 *   - "forced" mode flips that originate from outside the user (e.g., plan
 *     approval auto-flipping to agent, session resume restoring stored mode)
 *
 * **No imports from `react`, `jotai`, `@trpc/*`, or anything in `features/`.**
 * Decision logic only — wiring belongs in a service or hook.
 *
 * Regression coverage:
 *   - PR #36: model-switch must run synchronously before any await; the
 *     machine forbids re-toggling mode while the previous switch is still
 *     mid-stream so callers can't observe a half-applied state.
 *   - PR #51: stale DB hydration must not clobber a forced mode change. The
 *     `HYDRATE` event is rejected if `hydrationVersion` is older than the one
 *     last applied by the machine.
 *   - PR #38: every mode transition emits a `mustApplyDefaults` flag so the
 *     caller knows to invoke `applyModeDefaultModel` synchronously.
 */

export type ChatMode = "plan" | "agent" | "review"
export type ChatActivity = "idle" | "sending" | "streaming" | "errored"

export type ForcedModeReason =
  /** Plan approval flipped the mode to "agent". */
  | "plan-approved"
  /** Session resume hydrated a mode from the DB / atom store. */
  | "session-resumed"

export interface ChatModeState {
  mode: ChatMode
  activity: ChatActivity
  /**
   * Monotonically incremented whenever the machine commits a mode change.
   * Used to discard stale `HYDRATE` events that arrive after a forced flip.
   */
  hydrationVersion: number
  /** Whether the most recent transition requires the caller to re-apply mode defaults. */
  mustApplyDefaults: boolean
}

export type ChatModeEvent =
  | { type: "USER_TOGGLED_MODE"; to: ChatMode }
  | { type: "FORCE_MODE"; to: ChatMode; reason: ForcedModeReason }
  | { type: "HYDRATE"; from: ChatMode; hydrationVersion: number }
  | { type: "SEND_REQUESTED" }
  | { type: "STREAM_STARTED" }
  | { type: "STREAM_COMPLETED" }
  | { type: "STREAM_ERRORED" }
  | { type: "ERROR_CLEARED" }
  | { type: "CANCEL_REQUESTED" }

export function initialChatModeState(initial: ChatMode = "agent"): ChatModeState {
  return {
    mode: initial,
    activity: "idle",
    hydrationVersion: 0,
    mustApplyDefaults: false,
  }
}

/**
 * Pure reducer. Returns the next state. Never mutates the input.
 *
 * Invariants:
 *   - Mode toggles requested by the user are rejected while activity !== "idle".
 *     The caller is expected to disable the UI control during streaming/sending.
 *   - `FORCE_MODE` always wins (used for plan-approval auto-flip and session
 *     resume); it bumps `hydrationVersion` so a stale `HYDRATE` cannot revert it.
 *   - `HYDRATE` is rejected if its `hydrationVersion` is strictly less than the
 *     current version (stale refetch race — PR #51).
 *   - Every transition that changes `mode` sets `mustApplyDefaults: true`; any
 *     other transition clears it on the next event.
 */
export function reduceChatMode(state: ChatModeState, event: ChatModeEvent): ChatModeState {
  // Default: clear the one-shot mustApplyDefaults flag unless this transition sets it again.
  const cleared: ChatModeState = { ...state, mustApplyDefaults: false }

  switch (event.type) {
    case "USER_TOGGLED_MODE": {
      // Reject toggle while busy. Caller MUST gate the UI.
      if (state.activity !== "idle") return cleared
      if (state.mode === event.to) return cleared
      return {
        ...cleared,
        mode: event.to,
        hydrationVersion: state.hydrationVersion + 1,
        mustApplyDefaults: true,
      }
    }

    case "FORCE_MODE": {
      // Force always wins, even mid-stream — plan approval auto-flip happens
      // immediately after STREAM_COMPLETED and before the next SEND_REQUESTED.
      if (state.mode === event.to) {
        // Same target — still bump version so a stale HYDRATE can't revert.
        return { ...cleared, hydrationVersion: state.hydrationVersion + 1 }
      }
      return {
        ...cleared,
        mode: event.to,
        hydrationVersion: state.hydrationVersion + 1,
        mustApplyDefaults: true,
      }
    }

    case "HYDRATE": {
      // Stale hydration race (PR #51): a refetch arriving after a forced flip
      // would otherwise overwrite the new mode back to the persisted one.
      if (event.hydrationVersion < state.hydrationVersion) return cleared
      if (state.mode === event.from) {
        return { ...cleared, hydrationVersion: event.hydrationVersion }
      }
      return {
        ...cleared,
        mode: event.from,
        hydrationVersion: event.hydrationVersion,
        mustApplyDefaults: true,
      }
    }

    case "SEND_REQUESTED": {
      if (state.activity !== "idle") return cleared
      return { ...cleared, activity: "sending" }
    }

    case "STREAM_STARTED": {
      // Tolerate STREAM_STARTED from idle (server-initiated stream).
      return { ...cleared, activity: "streaming" }
    }

    case "STREAM_COMPLETED": {
      return { ...cleared, activity: "idle" }
    }

    case "STREAM_ERRORED": {
      return { ...cleared, activity: "errored" }
    }

    case "ERROR_CLEARED": {
      if (state.activity !== "errored") return cleared
      return { ...cleared, activity: "idle" }
    }

    case "CANCEL_REQUESTED": {
      // Cancel from any non-idle state returns to idle.
      if (state.activity === "idle") return cleared
      return { ...cleared, activity: "idle" }
    }
  }
}

/**
 * Convenience: replay a sequence of events on top of an initial state.
 * Useful for tests that simulate a full flow (sending → streaming → completed).
 */
export function runChatMode(
  initial: ChatModeState,
  events: ReadonlyArray<ChatModeEvent>,
): ChatModeState {
  return events.reduce(reduceChatMode, initial)
}
