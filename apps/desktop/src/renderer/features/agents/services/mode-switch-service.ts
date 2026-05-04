/**
 * Mode-switch orchestrator service.
 *
 * Wraps the mode-toggle path in `active-chat.tsx` (Plan ↔ Agent ↔ Review) so
 * the call ordering invariants are testable in isolation. The pure FSM lives
 * in `machines/chat-mode-machine.ts`; this service composes it with the side
 * effects (atom writes, DB persist, default-model application).
 *
 * **Layering rule**: imports from `machines/` only. No `react`, `jotai`,
 * `@trpc/*`, or `features/agents/main/*`.
 *
 * Regression invariants encoded here:
 *
 *   1. **PR #36** — toggling mode MUST run `applyDefaultModel` synchronously
 *      before any await. The transport reads `subChatModelIdAtomFamily` at
 *      send-time; yielding the event loop after `setMode` but before
 *      `applyDefaultModel` would mean the next message goes out with the
 *      previous mode's model.
 *
 *   2. **PR #38** — every mode change must propagate the per-mode default
 *      model + thinking. Encoded by always calling `applyDefaultModel`,
 *      regardless of source (user toggle, session resume, plan approval).
 *
 *   3. **PR #51** — `HYDRATE` events from a stale DB refetch must NOT clobber
 *      a forced flip. The FSM's `hydrationVersion` field guards this; the
 *      service's `hydrate()` method bumps the version on every commit so the
 *      caller (active-chat's `dbSubChats` effect) can drop stale events by
 *      version.
 *
 *   4. **Mode toggles are rejected mid-stream** (FSM rule). The service's
 *      `toggle()` returns `{ ok: false, reason: "busy" }` if the activity
 *      isn't idle, and the caller is expected to gate the UI control.
 *
 * `ModeContext` aliases the same union used by `applyModeDefaultModel`
 * ("plan" | "agent" | "review") so the wiring in `active-chat.tsx` is a
 * 1:1 mapping with no translation layer.
 */

import {
  initialChatModeState,
  reduceChatMode,
  type ChatActivity,
  type ChatMode,
  type ChatModeEvent,
  type ChatModeState,
  type ForcedModeReason
} from '../machines/chat-mode-machine';
import type { ProviderId } from '../machines/transport-lifecycle';

/** Subset of modes that have a per-mode default model (matches `ModeContext`). */
export type ModeContext = ChatMode;

export interface ModeSwitchDeps {
  /** Read current FSM state. The caller (active-chat) keeps the state in a ref. */
  readState: (subChatId: string) => ChatModeState;
  /** Write the new FSM state back. Wraps a `setState` or atom write. */
  writeState: (subChatId: string, state: ChatModeState) => void;

  /**
   * Synchronous mode flip. Writes both the per-subChat atom AND
   * `subChatModesStorageAtom` AND the Zustand store. Must NOT await internally.
   */
  setMode: (subChatId: string, mode: ChatMode) => void;

  /**
   * Synchronous wrapper around `applyModeDefaultModel(subChatId, mode)`.
   * Returns the resolved provider; the caller may use this to recreate the
   * transport if it differs from the previous one (cross-provider flip).
   *
   * **Must run before any await** — invariant from PR #36.
   */
  applyDefaultModel: (subChatId: string, mode: ModeContext) => { modelId: string; provider: ProviderId };

  /**
   * Async DB persist. Wraps `api.agents.updateSubChatMode.useMutation`.
   * The caller decides whether to skip for `temp-` IDs; the service just
   * awaits whatever is passed in.
   */
  persistMode?: (input: { subChatId: string; mode: ChatMode }) => Promise<void>;

  /**
   * Optional: notify the renderer that the provider has changed (so the
   * transport can be torn down + recreated). Wires to `setSubChatProviderOverrides`.
   * Only fires when the resolved provider differs from `previousProvider`.
   */
  notifyProviderChange?: (subChatId: string, provider: ProviderId) => void;

  /** Optional logger. */
  log?: (msg: string) => void;
}

export interface ToggleResult {
  ok: boolean;
  /** Final FSM state after the flow. */
  finalState: ChatModeState;
  /** Set when ok is false. */
  reason?: 'busy' | 'no-change' | 'persist-failed';
  /** Resolved provider after applyDefaultModel — only set when ok=true. */
  provider?: ProviderId;
  /** True if the flow caused a cross-provider switch (notifyProviderChange fired). */
  crossProvider?: boolean;
}

/**
 * User-initiated mode toggle (Shift-Tab / `/plan` / `/agent`).
 *
 * Rejected mid-stream by the FSM. The caller MUST gate the UI control on
 * `state.activity === "idle"` to avoid surfacing the rejection to the user.
 */
export async function toggleMode(subChatId: string, to: ChatMode, deps: ModeSwitchDeps): Promise<ToggleResult> {
  const log = deps.log ?? (() => {});
  const previousState = deps.readState(subChatId);

  // Capture previousProvider BEFORE applyDefaultModel writes the override atom.
  // toggleMode doesn't have direct access to the existing transport like
  // approvePlan does, so the caller is expected to read the current
  // `subChatProviderOverrideAtomFamily` and pass it in via deps if it
  // wants cross-provider notification. Here we just compare via the
  // applyDefaultModel return value — `crossProvider` is set when the
  // resolved provider differs from the FSM's last-applied provider, which
  // we can't observe directly. Fall back to: notifyProviderChange always
  // fires when defined; the caller can no-op if same-provider.

  // Drive the FSM with the user toggle event.
  const candidate = reduceChatMode(previousState, { type: 'USER_TOGGLED_MODE', to });

  if (candidate.mode === previousState.mode && previousState.activity === 'idle') {
    // No-op (already in target mode).
    return { ok: false, finalState: candidate, reason: 'no-change' };
  }

  if (candidate.mode === previousState.mode && previousState.activity !== 'idle') {
    // FSM rejected the toggle (busy).
    log(`[MODE] toggle:rejected sub=${subChatId.slice(-8)} ` + `to=${to} activity=${previousState.activity}`);
    return { ok: false, finalState: candidate, reason: 'busy' };
  }

  // 1. Synchronous mode flip (PR #38).
  deps.setMode(subChatId, to);

  // 2. Apply mode-default model SYNCHRONOUSLY before any await (PR #36).
  const { provider } = deps.applyDefaultModel(subChatId, to);
  log(`[MODE] toggle:applied sub=${subChatId.slice(-8)} mode=${to} provider=${provider}`);

  // 3. Cross-provider notification — caller decides via the optional dep.
  if (deps.notifyProviderChange) {
    deps.notifyProviderChange(subChatId, provider);
  }

  // 4. Persist to DB (best-effort; no rollback because the FSM has already
  //    committed). The caller decides what to do on failure (typically toast).
  let persistFailed = false;
  if (deps.persistMode) {
    try {
      await deps.persistMode({ subChatId, mode: to });
    } catch (err) {
      persistFailed = true;
      log(
        `[MODE] toggle:persist-failed sub=${subChatId.slice(-8)} ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  deps.writeState(subChatId, candidate);

  if (persistFailed) {
    return {
      ok: false,
      finalState: candidate,
      reason: 'persist-failed',
      provider
    };
  }

  return {
    ok: true,
    finalState: candidate,
    provider,
    crossProvider: !!deps.notifyProviderChange
  };
}

/**
 * Forced mode flip (plan approval, session resume).
 *
 * Forced events bypass the activity gate (the FSM's `FORCE_MODE` always wins).
 * Used by `approvePlan` to flip `plan → agent` even mid-stream, and by the
 * session-resume path to restore the persisted mode.
 *
 * `setMode` and `applyDefaultModel` still run synchronously before any await.
 */
export async function forceMode(
  subChatId: string,
  to: ChatMode,
  reason: ForcedModeReason,
  deps: ModeSwitchDeps
): Promise<ToggleResult> {
  const log = deps.log ?? (() => {});
  const previousState = deps.readState(subChatId);

  const candidate = reduceChatMode(previousState, { type: 'FORCE_MODE', to, reason });

  // FORCE_MODE always commits; mustApplyDefaults is true unless the target
  // already matches.
  if (candidate.mustApplyDefaults) {
    deps.setMode(subChatId, to);
    const { provider } = deps.applyDefaultModel(subChatId, to);
    if (deps.notifyProviderChange) {
      deps.notifyProviderChange(subChatId, provider);
    }
    log(`[MODE] force:applied sub=${subChatId.slice(-8)} ` + `mode=${to} reason=${reason} provider=${provider}`);

    let persistFailed = false;
    if (deps.persistMode) {
      try {
        await deps.persistMode({ subChatId, mode: to });
      } catch (err) {
        persistFailed = true;
        log(
          `[MODE] force:persist-failed sub=${subChatId.slice(-8)} ` +
            `${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    deps.writeState(subChatId, candidate);

    if (persistFailed) {
      return { ok: false, finalState: candidate, reason: 'persist-failed', provider };
    }

    return {
      ok: true,
      finalState: candidate,
      provider,
      crossProvider: !!deps.notifyProviderChange
    };
  }

  // Same target: just bump the hydration version (FSM already did this).
  deps.writeState(subChatId, candidate);
  return { ok: true, finalState: candidate };
}

/**
 * Hydrate from DB / atom store (called by the `dbSubChats` query effect).
 *
 * The FSM rejects events whose `hydrationVersion` is older than the current
 * one (PR #51). The caller is expected to track the version it last applied
 * and pass it in here so a stale refetch can't overwrite a forced flip.
 *
 * No side effects — hydration is the *source* of truth for an initial mount,
 * not a write target.
 */
export function hydrateMode(
  subChatId: string,
  from: ChatMode,
  hydrationVersion: number,
  deps: Pick<ModeSwitchDeps, 'readState' | 'writeState' | 'setMode' | 'applyDefaultModel'>
): { applied: boolean; finalState: ChatModeState } {
  const state = deps.readState(subChatId);
  const candidate = reduceChatMode(state, { type: 'HYDRATE', from, hydrationVersion });
  // Stale-rejected (PR #51): the FSM returns a refreshed state with the same
  // mode + same hydrationVersion when it ignores the event. Detect that here
  // by comparing both fields, not by reference identity (the FSM always
  // produces a new object to clear the one-shot mustApplyDefaults flag).
  const staleRejected = candidate.mode === state.mode && candidate.hydrationVersion === state.hydrationVersion;
  if (staleRejected) {
    return { applied: false, finalState: candidate };
  }
  if (candidate.mode !== state.mode) {
    deps.setMode(subChatId, candidate.mode);
    if (candidate.mustApplyDefaults) {
      deps.applyDefaultModel(subChatId, candidate.mode);
    }
  }
  deps.writeState(subChatId, candidate);
  return { applied: true, finalState: candidate };
}

/** Stream-event passthroughs — let the FSM track activity for toggle gating. */
export function noteSendRequested(
  subChatId: string,
  deps: Pick<ModeSwitchDeps, 'readState' | 'writeState'>
): ChatModeState {
  return advance(subChatId, { type: 'SEND_REQUESTED' }, deps);
}
export function noteStreamStarted(
  subChatId: string,
  deps: Pick<ModeSwitchDeps, 'readState' | 'writeState'>
): ChatModeState {
  return advance(subChatId, { type: 'STREAM_STARTED' }, deps);
}
export function noteStreamCompleted(
  subChatId: string,
  deps: Pick<ModeSwitchDeps, 'readState' | 'writeState'>
): ChatModeState {
  return advance(subChatId, { type: 'STREAM_COMPLETED' }, deps);
}
export function noteStreamErrored(
  subChatId: string,
  deps: Pick<ModeSwitchDeps, 'readState' | 'writeState'>
): ChatModeState {
  return advance(subChatId, { type: 'STREAM_ERRORED' }, deps);
}
export function noteCancelRequested(
  subChatId: string,
  deps: Pick<ModeSwitchDeps, 'readState' | 'writeState'>
): ChatModeState {
  return advance(subChatId, { type: 'CANCEL_REQUESTED' }, deps);
}

function advance(
  subChatId: string,
  event: ChatModeEvent,
  deps: Pick<ModeSwitchDeps, 'readState' | 'writeState'>
): ChatModeState {
  const state = deps.readState(subChatId);
  const next = reduceChatMode(state, event);
  if (next !== state) {
    deps.writeState(subChatId, next);
  }
  return next;
}

/** Initial state factory mirrored from the FSM. */
export function initialState(initialMode: ChatMode = 'agent'): ChatModeState {
  return initialChatModeState(initialMode);
}

export type { ChatMode, ChatActivity, ChatModeState, ForcedModeReason };
