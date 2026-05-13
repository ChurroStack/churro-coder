import { describe, expect, it, vi } from 'vitest';
import { createUpdateSubChatModeOnSuccess } from './update-sub-chat-mode-callbacks';

describe('createUpdateSubChatModeOnSuccess', () => {
  /**
   * Regression guard for the new-chat mode-dropdown race fix in
   * `active-chat.tsx`. The dropdown writer flows through
   * `toggleModeService` → `useModeSwitchDeps` → `api.agents.updateSubChatMode`,
   * so this mutation's onSuccess is the dominant invalidation site. If a
   * future refactor drops the `trpcUtils.chats.getSubChat.invalidate` call,
   * a stale getSubChat response can pin the dropdown to the pre-click value.
   */
  it('invalidates both agents.getAgentChat and chats.getSubChat on success', () => {
    const getAgentChatInvalidate = vi.fn();
    const getSubChatInvalidate = vi.fn();
    const apiUtils = {
      agents: { getAgentChat: { invalidate: getAgentChatInvalidate } }
    };
    const trpcUtils = {
      chats: { getSubChat: { invalidate: getSubChatInvalidate } }
    };

    const onSuccess = createUpdateSubChatModeOnSuccess(apiUtils, trpcUtils, 'chat-42');
    onSuccess({}, { subChatId: 'sub-7' });

    expect(getAgentChatInvalidate).toHaveBeenCalledTimes(1);
    expect(getAgentChatInvalidate).toHaveBeenCalledWith({ chatId: 'chat-42' });

    // The critical assertion for the dropdown-race fix.
    expect(getSubChatInvalidate).toHaveBeenCalledTimes(1);
    expect(getSubChatInvalidate).toHaveBeenCalledWith({ id: 'sub-7' });
  });

  it('keys the getSubChat invalidation by the variable subChatId, not the parent chatId', () => {
    // Guards against a copy-paste regression where the dropdown invalidation
    // gets keyed by parentChatId (matching the agent-chat invalidation),
    // which would invalidate a non-existent cache entry and silently
    // re-introduce the race.
    const getAgentChatInvalidate = vi.fn();
    const getSubChatInvalidate = vi.fn();
    const apiUtils = {
      agents: { getAgentChat: { invalidate: getAgentChatInvalidate } }
    };
    const trpcUtils = {
      chats: { getSubChat: { invalidate: getSubChatInvalidate } }
    };

    const onSuccess = createUpdateSubChatModeOnSuccess(apiUtils, trpcUtils, 'parent-chat');
    onSuccess({}, { subChatId: 'distinct-sub-chat' });

    expect(getSubChatInvalidate).toHaveBeenCalledWith({ id: 'distinct-sub-chat' });
    expect(getSubChatInvalidate).not.toHaveBeenCalledWith({ id: 'parent-chat' });
  });
});
