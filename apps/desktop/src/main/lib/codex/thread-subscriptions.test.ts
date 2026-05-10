import { describe, expect, test, vi } from 'vitest';
import {
  cleanupCodexThreadSubscription,
  trackCodexThreadSubscription,
  unsubscribeCodexSessionThreads,
  type CodexThreadSubscriptionMaps
} from './thread-subscriptions';

function createMaps(): CodexThreadSubscriptionMaps {
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

  test('session unsubscribe deduplicates repeated threads across tracked sub-chats', () => {
    const maps = createMaps();
    const notifyThreadUnsubscribe = vi.fn();

    trackCodexThreadSubscription(maps, {
      subChatId: 'sub-1',
      threadId: 'thread-1',
      sessionKey: 'session-a'
    });
    trackCodexThreadSubscription(maps, {
      subChatId: 'sub-2',
      threadId: 'thread-1',
      sessionKey: 'session-a'
    });
    trackCodexThreadSubscription(maps, {
      subChatId: 'sub-3',
      threadId: 'thread-3',
      sessionKey: 'session-b'
    });

    const threadIds = unsubscribeCodexSessionThreads(maps, {
      sessionKey: 'session-a',
      notifyThreadUnsubscribe
    });

    expect(threadIds).toEqual(['thread-1']);
    expect(notifyThreadUnsubscribe).toHaveBeenCalledTimes(1);
    expect(notifyThreadUnsubscribe).toHaveBeenCalledWith('thread-1');
  });
});
