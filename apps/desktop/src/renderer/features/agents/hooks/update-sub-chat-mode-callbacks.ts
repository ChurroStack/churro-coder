/**
 * Pure helpers that build the `onSuccess` callback for
 * `api.agents.updateSubChatMode.useMutation` in `active-chat.tsx`.
 *
 * Extracted so the cache-invalidation wiring (which closes the new-chat
 * mode-dropdown race — see `use-sub-chat-mode.test.tsx`) is unit-testable
 * without mounting the whole `active-chat.tsx` component tree.
 *
 * The active-chat flow is the dominant write path for the mode dropdown
 * (the dropdown writer goes through `toggleModeService` → `useModeSwitchDeps`
 * → `api.agents.updateSubChatMode`), so silently losing this invalidation
 * is a real regression risk worth a test.
 */

export interface ApiAgentsInvalidator {
  agents: {
    getAgentChat: { invalidate: (input: { chatId: string }) => unknown };
  };
}

export interface TrpcChatsInvalidator {
  chats: {
    getSubChat: { invalidate: (input: { id: string }) => unknown };
  };
}

export interface UpdateSubChatModeVariables {
  subChatId: string;
}

/**
 * Build the `onSuccess` handler for the `updateSubChatMode` mutation.
 *
 * Invalidates two caches:
 *  1. `agents.getAgentChat` — so the agent panel reflects the new mode.
 *  2. `chats.getSubChat` — so the mode-dropdown reader (`useSubChatMode`)
 *     re-fetches and cannot stay pinned to a stale pre-click value.
 */
export function createUpdateSubChatModeOnSuccess(
  apiUtils: ApiAgentsInvalidator,
  trpcUtils: TrpcChatsInvalidator,
  parentChatId: string
): (data: unknown, variables: UpdateSubChatModeVariables) => void {
  return (_data, variables) => {
    apiUtils.agents.getAgentChat.invalidate({ chatId: parentChatId });
    trpcUtils.chats.getSubChat.invalidate({ id: variables.subChatId });
  };
}
