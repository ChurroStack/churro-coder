import { describe, expect, test, vi } from 'vitest';
import {
  cleanupCodexThreadSubscription,
  trackCodexThreadSubscription,
  type CodexThreadSubscriptionMaps
} from './thread-subscriptions';

type TestMaps = CodexThreadSubscriptionMaps & {
  activeAppServerTurns: Map<string, unknown>;
};

function createMaps(): TestMaps {
  return {
    subChatThreadIds: new Map(),
    subChatSessionKeys: new Map(),
    activeStreamsByThreadId: new Map(),
    activeAppServerTurns: new Map(),
    activeThreadIdsByTurnId: new Map()
  };
}

describe('codex thread subscriptions', () => {
  test('cleanup unsubscribes and removes tracked mappings for a sub-chat', () => {
    const maps = createMaps();
    const notifyThreadUnsubscribe = vi.fn();

    trackCodexThreadSubscription(maps, {
      subChatId: 'sub-1',
      threadId: 'thread-1',
      sessionKey: 'session-a'
    });
    maps.activeAppServerTurns.set('thread-1', { active: true });
    maps.activeThreadIdsByTurnId.set('turn-1', 'thread-1');

    const threadId = cleanupCodexThreadSubscription(maps, {
      subChatId: 'sub-1',
      notifyThreadUnsubscribe
    });

    expect(threadId).toBe('thread-1');
    expect(notifyThreadUnsubscribe).toHaveBeenCalledWith('thread-1');
    expect(maps.subChatThreadIds.size).toBe(0);
    expect(maps.subChatSessionKeys.size).toBe(0);
    expect(maps.activeStreamsByThreadId.size).toBe(0);
    expect(maps.activeAppServerTurns.size).toBe(0);
    expect(maps.activeThreadIdsByTurnId.size).toBe(0);
  });

  test('cleanup is a no-op (and skips notify) when the sub-chat has no tracked thread', () => {
    const maps = createMaps();
    const notifyThreadUnsubscribe = vi.fn();
    maps.subChatSessionKeys.set('orphan-sub', 'session-a');

    const threadId = cleanupCodexThreadSubscription(maps, {
      subChatId: 'orphan-sub',
      notifyThreadUnsubscribe
    });

    expect(threadId).toBeUndefined();
    expect(notifyThreadUnsubscribe).not.toHaveBeenCalled();
    // Stale session-key pointer is still cleared so the registry doesn't leak.
    expect(maps.subChatSessionKeys.has('orphan-sub')).toBe(false);
  });
});
