/**
 * L4 integration: switching parent workspaces evicts renderer chat instances
 * without calling transport cleanup on the old workspace's running chat.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { evictChatsForParentChatSwitch, evictInactiveChatsForWorkspace } from '../../lib/chat-instance-pruning';
import { agentChatStore } from '../../stores/agent-chat-store';

function makeChat(cleanup = vi.fn()) {
  return {
    transport: {
      cleanup
    }
  } as any;
}

describe('L4 integration — workspace switch pruning preserves transport cleanup', () => {
  beforeEach(() => {
    agentChatStore.clear();
    vi.clearAllMocks();
  });

  test('switching parent chat away from a running sub-chat does not call transport.cleanup', () => {
    const runningCleanup = vi.fn();
    const siblingCleanup = vi.fn();
    const nextWorkspaceCleanup = vi.fn();
    const clearRuntimeCachesForSubChat = vi.fn();

    agentChatStore.set('sub-running', makeChat(runningCleanup), 'workspace-a');
    agentChatStore.set('sub-sibling', makeChat(siblingCleanup), 'workspace-a');
    agentChatStore.set('sub-next', makeChat(nextWorkspaceCleanup), 'workspace-b');

    evictChatsForParentChatSwitch('workspace-a', 'workspace-b', clearRuntimeCachesForSubChat);

    expect(runningCleanup).not.toHaveBeenCalled();
    expect(siblingCleanup).not.toHaveBeenCalled();
    expect(nextWorkspaceCleanup).not.toHaveBeenCalled();
    expect(agentChatStore.has('sub-running')).toBe(false);
    expect(agentChatStore.has('sub-sibling')).toBe(false);
    expect(agentChatStore.has('sub-next')).toBe(true);
    expect(clearRuntimeCachesForSubChat).toHaveBeenCalledTimes(2);
    expect(clearRuntimeCachesForSubChat).toHaveBeenCalledWith('sub-running');
    expect(clearRuntimeCachesForSubChat).toHaveBeenCalledWith('sub-sibling');
  });

  test('within-workspace cache bounding evicts detached chats without cleanup', () => {
    const activeCleanup = vi.fn();
    const keptCleanup = vi.fn();
    const evictedCleanup = vi.fn();
    const otherWorkspaceCleanup = vi.fn();
    const clearRuntimeCachesForSubChat = vi.fn();

    agentChatStore.set('sub-active', makeChat(activeCleanup), 'workspace-a');
    agentChatStore.set('sub-kept', makeChat(keptCleanup), 'workspace-a');
    agentChatStore.set('sub-evicted', makeChat(evictedCleanup), 'workspace-a');
    agentChatStore.set('sub-other-workspace', makeChat(otherWorkspaceCleanup), 'workspace-b');

    evictInactiveChatsForWorkspace('workspace-a', ['sub-active', 'sub-kept'], clearRuntimeCachesForSubChat);

    expect(activeCleanup).not.toHaveBeenCalled();
    expect(keptCleanup).not.toHaveBeenCalled();
    expect(evictedCleanup).not.toHaveBeenCalled();
    expect(otherWorkspaceCleanup).not.toHaveBeenCalled();
    expect(agentChatStore.has('sub-active')).toBe(true);
    expect(agentChatStore.has('sub-kept')).toBe(true);
    expect(agentChatStore.has('sub-evicted')).toBe(false);
    expect(agentChatStore.has('sub-other-workspace')).toBe(true);
    expect(clearRuntimeCachesForSubChat).toHaveBeenCalledTimes(1);
    expect(clearRuntimeCachesForSubChat).toHaveBeenCalledWith('sub-evicted');
  });
});
