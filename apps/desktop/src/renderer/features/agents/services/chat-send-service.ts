/**
 * Chat-send orchestrator service.
 *
 * Wraps the family of "send a message that was authored elsewhere" flows in
 * `active-chat.tsx`. There are six near-identical effects today (one per
 * `pendingXxxMessageAtom`); the service collapses the pattern into one
 * function so:
 *   - the call ordering invariant ("clear pending atom BEFORE awaiting
 *     sendMessage so a re-render can't fire the same prompt twice") is
 *     enforced once instead of replicated six times;
 *   - the gating logic ("only send when this is the active subChatId AND
 *     activity is idle") is testable in isolation; and
 *   - new pending-message types (e.g. a future "merge from remote" prompt)
 *     just pass through the same function with a different atom binding.
 *
 * **Layering rule**: no React, no Jotai, no tRPC. The atom read/write is
 * passed in via `pending` + `clearPending` so the test can use a plain
 * mutable reference without a React tree.
 *
 * Regression invariants encoded here:
 *
 *   - **Always clear before await.** The renderer re-runs the effect on every
 *     render; clearing the atom before `await sendMessage(...)` prevents
 *     a stale read on the next render from re-firing the same prompt.
 *
 *   - **Idle-only.** All six effects in `active-chat.tsx` gate on `!isStreaming`.
 *     The service centralizes the gate and exposes it as a single check.
 *
 *   - **Subchat-scoped.** Each pending atom has a `subChatId` field; only the
 *     matching mount fires. The service compares `pending.subChatId` with the
 *     mount's `subChatId` and no-ops otherwise.
 */

export interface PendingMessage {
  subChatId: string;
  /** Plain text body (most pending atoms carry this shape). */
  text?: string;
  /** Pre-built parts (used by handleApprovePlan's deferred send). */
  parts?: unknown[];
}

export interface SendDeps {
  /** Wraps the AI SDK `sendMessage` callback. Async because the SDK is. */
  sendMessage: (msg: { role: 'user'; parts: unknown[] }) => Promise<void> | void;
  /** Read current streaming activity. The renderer wires this to `isStreaming` from `useChat`. */
  isStreaming: () => boolean;
  /** Optional logger. */
  log?: (msg: string) => void;
}

export interface SendResult {
  sent: boolean;
  /** Set when sent=false; explains why the gate rejected. */
  reason?: 'no-pending' | 'wrong-sub-chat' | 'busy';
}

/**
 * Drain a pending-message atom, sending its body once if the gate is open.
 *
 * Idempotent: clears the pending atom BEFORE awaiting sendMessage. If
 * sendMessage throws, the pending atom is NOT restored — the renderer's old
 * effect didn't restore it either, and re-trying a failed send from a stale
 * effect read tends to mask the real error.
 *
 * @param mountSubChatId — subChatId of the mounted ChatViewInner that's calling this.
 *                        The service compares against `pending.subChatId` and no-ops on mismatch.
 * @param pending        — current value of the pending atom (or null if the atom is empty).
 * @param clearPending   — synchronous setter that writes `null` to the atom.
 * @param deps           — sendMessage + isStreaming.
 */
export async function sendPendingMessage(
  mountSubChatId: string,
  pending: PendingMessage | null,
  clearPending: () => void,
  deps: SendDeps
): Promise<SendResult> {
  const log = deps.log ?? (() => {});

  if (!pending) {
    return { sent: false, reason: 'no-pending' };
  }
  if (pending.subChatId !== mountSubChatId) {
    return { sent: false, reason: 'wrong-sub-chat' };
  }
  if (deps.isStreaming()) {
    return { sent: false, reason: 'busy' };
  }

  // Clear the pending atom FIRST. If we were to clear it after the send,
  // a re-render between the read and the await could see the stale value
  // and fire the prompt again. (This is the invariant from active-chat.tsx
  // line 2983 / 3010 / 3027 / 3043 / 3058 / 3493.)
  clearPending();

  const parts: unknown[] = pending.parts ?? [{ type: 'text', text: pending.text ?? '' }];

  try {
    await deps.sendMessage({ role: 'user', parts });
    log(`[SEND] sent sub=${mountSubChatId.slice(-8)} kind=${pending.parts ? 'parts' : 'text'}`);
    return { sent: true };
  } catch (err) {
    log(`[SEND] failed sub=${mountSubChatId.slice(-8)} ` + `${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

/**
 * Compose multiple pending-message atoms into one call. The renderer can
 * stop replicating six near-identical `useEffect` blocks and call this with
 * the array of `(pending, setter)` pairs it manages.
 *
 * Consumes ONE pending atom per invocation, in array order. Stops at the
 * first sent prompt (so two pending atoms set on the same render don't
 * collide). Returns the result of the consumed atom (or no-pending if none
 * matched).
 */
export async function drainFirstPending(
  mountSubChatId: string,
  candidates: ReadonlyArray<{
    pending: PendingMessage | null;
    clearPending: () => void;
  }>,
  deps: SendDeps
): Promise<SendResult> {
  if (deps.isStreaming()) {
    return { sent: false, reason: 'busy' };
  }

  for (const { pending, clearPending } of candidates) {
    if (!pending || pending.subChatId !== mountSubChatId) continue;
    return await sendPendingMessage(mountSubChatId, pending, clearPending, deps);
  }
  return { sent: false, reason: 'no-pending' };
}
