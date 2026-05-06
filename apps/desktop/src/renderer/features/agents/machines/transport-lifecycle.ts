/**
 * Pure decision logic for transport lifecycle in active-chat.tsx.
 *
 * Extracted from `getOrCreateChat` (apps/desktop/src/renderer/features/agents/main/active-chat.tsx)
 * and the cross-provider branch of `handleApprovePlan`. Encodes the rules
 * documented across PRs #44 (orphaned in-flight events when transport is
 * unnecessarily recreated) and #40 (stale config captured at construction).
 *
 * **No imports from `react`, `jotai`, `@trpc/*`, or anything in `features/`.**
 * This file must remain a pure function library so it can be unit-tested in
 * Node without a DOM, IPC bridge, or atom store.
 */

export type ProviderId = 'claude-code' | 'codex';

export type TransportAction =
  /** No existing chat — instantiate a new transport. */
  | { kind: 'create'; provider: ProviderId; isRemote: boolean }
  /** Existing transport is correct for the target — reuse as-is. */
  | { kind: 'keep' }
  /** Existing transport must be torn down and replaced (cross-provider, stale, etc.). */
  | { kind: 'recreate'; provider: ProviderId; isRemote: boolean; reason: RecreateReason };

export type RecreateReason =
  /** `shouldRecreateStaleRuntimeChat` returned true (runtime cache outlived persisted messages). */
  | 'stale-runtime'
  /** Cross-provider switch on a sub-chat with no persisted messages yet (e.g., right after create). */
  | 'cross-provider-empty'
  /** Plan approval flipped from one provider to another mid-conversation. */
  | 'plan-approval-cross-provider';

export interface TransportInput {
  /** Whether a Chat instance is already in `agentChatStore` for this subChatId. */
  hasExisting: boolean;
  /** Provider of the existing transport, inferred from `transport instanceof CodexChatTransport`. */
  existingProvider: ProviderId | null;
  /** Whether the existing chat is a remote/sandbox chat — those are never recreated. */
  existingIsRemote: boolean;
  /** Provider we want the next message to use. */
  targetProvider: ProviderId;
  /** Whether the target should be a remote/sandbox chat. */
  targetIsRemote: boolean;
  /** Whether the existing chat is currently mid-stream (don't tear it down). */
  isStreaming: boolean;
  /** Whether the existing chat has queued messages waiting to fire (don't tear it down). */
  hasQueue: boolean;
  /** Result of `shouldRecreateStaleRuntimeChat` — runtime/persisted divergence flag. */
  isStaleRuntime: boolean;
  /** Whether the sub-chat has any persisted messages. */
  hasMessages: boolean;
}

/**
 * Decide what to do with the existing (or missing) transport for a sub-chat.
 *
 * Rules (in order; first match wins):
 *
 * 1. No existing transport → CREATE
 * 2. Existing chat is remote → KEEP (remote sandbox transports are pinned)
 * 3. Stale runtime + idle (no stream, no queue) → RECREATE("stale-runtime")
 * 4. Provider matches → KEEP (cross-provider not needed)
 * 5. Provider mismatch + has messages / live work → KEEP (preserve in-flight
 *    events and don't tear down active/queued chats during workspace-switch
 *    races; the plan-approval flow handles cross-provider recreates
 *    explicitly via `decidePlanApprovalCrossProviderRecreate`, not via
 *    `getOrCreateChat`)
 * 6. Provider mismatch + no messages + idle → RECREATE("cross-provider-empty")
 *
 * The order matches the imperative branches in `getOrCreateChat` so behavior
 * is preserved verbatim. Future reordering must be backed by a test that
 * asserts the new order doesn't regress one of the documented PRs.
 */
export function decideTransportAction(input: TransportInput): TransportAction {
  if (!input.hasExisting) {
    return {
      kind: 'create',
      provider: input.targetProvider,
      isRemote: input.targetIsRemote
    };
  }

  if (input.existingIsRemote) {
    return { kind: 'keep' };
  }

  if (!input.isStreaming && !input.hasQueue && input.isStaleRuntime) {
    return {
      kind: 'recreate',
      provider: input.targetProvider,
      isRemote: input.targetIsRemote,
      reason: 'stale-runtime'
    };
  }

  if (input.existingProvider === input.targetProvider) {
    return { kind: 'keep' };
  }

  // Provider mismatch: keep the transport if we already have messages or if
  // the chat is mid-stream / has queued work. Workspace switches can
  // transiently mis-infer the provider before the new parent's sub-chat data
  // is available; tearing down here would drop the live Codex stream.
  if (input.hasMessages || input.isStreaming || input.hasQueue) {
    return { kind: 'keep' };
  }

  return {
    kind: 'recreate',
    provider: input.targetProvider,
    isRemote: input.targetIsRemote,
    reason: 'cross-provider-empty'
  };
}

/**
 * Decide whether plan approval requires a transport recreate.
 *
 * Same provider → keep transport so the SDK's native plan→default
 * permission-mode transition fires naturally and in-flight TodoWrite/Task
 * tool events aren't orphaned (the bug fixed by PR #44).
 *
 * Cross-provider → recreate so the new provider's transport is used; the
 * plan content is re-attached as a hidden file part to the next message.
 */
export function decidePlanApprovalCrossProviderRecreate(input: {
  previousProvider: ProviderId;
  newProvider: ProviderId;
  newIsRemote: boolean;
}): TransportAction {
  if (input.previousProvider === input.newProvider) {
    return { kind: 'keep' };
  }
  return {
    kind: 'recreate',
    provider: input.newProvider,
    isRemote: input.newIsRemote,
    reason: 'plan-approval-cross-provider'
  };
}
