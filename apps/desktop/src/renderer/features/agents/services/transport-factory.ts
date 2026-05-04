/**
 * Transport-factory service.
 *
 * Encapsulates the side effects of `getOrCreateChat` from `active-chat.tsx`
 * (the imperative one — lines 7256–7489). The pure decision function
 * (`decideTransportAction`) already lives in
 * `machines/transport-lifecycle.ts`; this service is the thin imperative
 * wrapper that turns the action into actual `Chat<any>` instances.
 *
 * Why separate from the renderer? Three reasons:
 *
 *   1. **No more `instanceof CodexChatTransport` checks scattered through
 *      `active-chat.tsx`.** The factory exposes a `provider` field on the
 *      result so callers don't reach into `chat.transport.constructor.name`.
 *
 *   2. **Constructors are injected.** L2 tests pass mocked transport
 *      constructors via {@link TransportFactoryDeps}; the renderer passes
 *      the real `IPCChatTransport` / `CodexChatTransport` /
 *      `RemoteChatTransport`.
 *
 *   3. **Lifecycle hooks are explicit.** `onError` / `onFinish` are
 *      configured via deps so the factory doesn't import audio playback,
 *      desktop notifications, or jotai write helpers.
 *
 * **Layering rule**: imports from `machines/` only. No `react`, no `jotai`,
 * no `@trpc/*`, no `features/agents/main/*`.
 *
 * Regression invariants:
 *   - **PR #40**: each transport is given the subChatId at construction;
 *     mode is read dynamically via `getCurrentSubChatMode(subChatId)` at
 *     send-time inside the transport. The factory does NOT pass `mode` in
 *     the config — that was the stale-config bug.
 *   - **PR #44**: cross-provider with messages → KEEP existing transport
 *     (handled by `decideTransportAction`).
 *   - **PR #52**: cross-provider plan approval explicitly recreates via
 *     `decidePlanApprovalCrossProviderRecreate` (handled by
 *     `plan-approval-service`).
 */

import {
  decideTransportAction,
  type ProviderId,
  type TransportInput,
  type TransportAction
} from '../machines/transport-lifecycle';

/**
 * The minimum surface a `Chat` instance needs to expose to the factory's
 * caller. Mirrors `Chat<any>` from `@ai-sdk/react`. We don't import the SDK
 * type here so the test can pass a plain object.
 */
export interface ChatLike {
  readonly id: string;
  /** The transport instance — used for `provider` detection and teardown. */
  transport?: { __kind?: 'mock-transport' } | unknown;
}

export interface TransportFactoryDeps<TChat extends ChatLike = ChatLike> {
  /**
   * Look up an existing Chat instance for `subChatId` (typically the
   * `agentChatStore` map in active-chat.tsx). Return null if none.
   */
  readExistingChat: (subChatId: string) => TChat | null;

  /** Read the messages already attached to an existing Chat. */
  readChatMessages: (chat: TChat) => unknown[];

  /** Read messages persisted in DB / atom store for the sub-chat. */
  readPersistedMessages: (subChatId: string) => unknown[];

  /** Whether the existing chat is currently mid-stream. */
  isStreaming: (subChatId: string) => boolean;

  /** Whether queued messages are waiting (don't tear down). */
  hasQueue: (subChatId: string) => boolean;

  /**
   * Pure check returning true when the runtime cache outlived the persisted
   * messages (typical after optimistic create + slow DB write). The renderer
   * already has `shouldRecreateStaleRuntimeChat` — wire it through here.
   */
  isStaleRuntime: (existingMessages: unknown[], persistedMessages: unknown[]) => boolean;

  /**
   * Detect the provider of an existing transport. The renderer's wiring is:
   *   `existing.transport instanceof CodexChatTransport ? "codex" : "claude-code"`.
   * Tests pass a stub returning whichever provider the test wants to simulate.
   */
  getExistingProvider: (chat: TChat) => ProviderId | null;

  /**
   * Remove the chat from the runtime cache (the renderer wires this to
   * `agentChatStore.delete(subChatId)`). Called after the FSM decides
   * RECREATE so the next read finds nothing.
   */
  deleteExistingChat: (subChatId: string) => void;

  /** Create a new Chat instance for the given action + persisted messages. */
  createChat: (input: ResolvedCreateInput, persistedMessages: unknown[]) => TChat;

  /** Save a freshly created chat into the runtime cache + record streamId. */
  storeChat: (subChatId: string, chat: TChat) => void;

  /** Optional logger. */
  log?: (msg: string) => void;
}

/**
 * Caller-supplied input describing what the next message wants. The factory
 * uses this to compute the action and execute it.
 */
export interface FactoryInput {
  subChatId: string;
  /** Provider the next message wants to use (read from per-mode default + override). */
  targetProvider: ProviderId;
  /** Whether the chat is a remote/sandbox chat (different transport entirely). */
  targetIsRemote: boolean;
}

/**
 * Inputs to {@link TransportFactoryDeps.createChat}. Resolved by the factory
 * after the FSM picks an action — the caller's `createChat` implementation
 * receives only what it needs to instantiate a transport + Chat.
 */
export interface ResolvedCreateInput {
  subChatId: string;
  provider: ProviderId;
  isRemote: boolean;
  /** Reason for creation, for logging. */
  reason: 'create' | 'recreate';
}

export interface FactoryResult<TChat extends ChatLike> {
  /** The Chat instance the caller should use. Null when the action can't be executed
      (e.g. no existing AND no transport could be built). */
  chat: TChat | null;
  /** What the FSM decided. Useful for assertion + logging. */
  action: TransportAction;
  /** Provider of the returned Chat. */
  provider: ProviderId | null;
}

/**
 * Run the factory: decide → execute → return.
 *
 * For the renderer, this replaces the imperative branches at lines 7256–7368
 * of active-chat.tsx. The renderer-specific concerns (audio, notifications,
 * `forceUpdate`) stay in the renderer; the factory just wires the FSM
 * decision to the constructor injection.
 */
export function getOrCreateChat<TChat extends ChatLike>(
  input: FactoryInput,
  deps: TransportFactoryDeps<TChat>
): FactoryResult<TChat> {
  const log = deps.log ?? (() => {});

  const existing = deps.readExistingChat(input.subChatId);
  const persistedMessages = deps.readPersistedMessages(input.subChatId);
  const existingMessages = existing ? deps.readChatMessages(existing) : [];

  const fsmInput: TransportInput = {
    hasExisting: !!existing,
    existingProvider: existing ? deps.getExistingProvider(existing) : null,
    existingIsRemote: input.targetIsRemote && !!existing && deps.getExistingProvider(existing) === null,
    targetProvider: input.targetProvider,
    targetIsRemote: input.targetIsRemote,
    isStreaming: deps.isStreaming(input.subChatId),
    hasQueue: deps.hasQueue(input.subChatId),
    isStaleRuntime: existing ? deps.isStaleRuntime(existingMessages, persistedMessages) : false,
    hasMessages: persistedMessages.length > 0
  };

  const action = decideTransportAction(fsmInput);

  log(
    `[TFAC] sub=${input.subChatId.slice(-8)} action=${action.kind} ` +
      `target=${input.targetProvider}/${input.targetIsRemote ? 'remote' : 'local'}`
  );

  switch (action.kind) {
    case 'keep': {
      return {
        chat: existing,
        action,
        provider: existing ? deps.getExistingProvider(existing) : null
      };
    }

    case 'create': {
      const chat = deps.createChat(
        {
          subChatId: input.subChatId,
          provider: action.provider,
          isRemote: action.isRemote,
          reason: 'create'
        },
        persistedMessages
      );
      deps.storeChat(input.subChatId, chat);
      return { chat, action, provider: action.provider };
    }

    case 'recreate': {
      // Delete first so any references to the old chat see it gone.
      deps.deleteExistingChat(input.subChatId);
      const chat = deps.createChat(
        {
          subChatId: input.subChatId,
          provider: action.provider,
          isRemote: action.isRemote,
          reason: 'recreate'
        },
        persistedMessages
      );
      deps.storeChat(input.subChatId, chat);
      return { chat, action, provider: action.provider };
    }
  }
}
