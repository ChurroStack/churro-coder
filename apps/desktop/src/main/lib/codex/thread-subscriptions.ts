export type CodexThreadSubscriptionMaps = {
  subChatThreadIds: Map<string, string>;
  subChatSessionKeys: Map<string, string>;
  activeStreamsByThreadId: Map<string, string>;
  activeAppServerTurns: Map<string, unknown>;
  activeThreadIdsByTurnId: Map<string, string>;
};

export function trackCodexThreadSubscription(
  maps: CodexThreadSubscriptionMaps,
  params: { subChatId: string; threadId: string; sessionKey: string }
): void {
  maps.subChatThreadIds.set(params.subChatId, params.threadId);
  maps.subChatSessionKeys.set(params.subChatId, params.sessionKey);
  maps.activeStreamsByThreadId.set(params.threadId, params.subChatId);
}

export function cleanupCodexThreadSubscription(
  maps: CodexThreadSubscriptionMaps,
  params: { subChatId: string; notifyThreadUnsubscribe?: (threadId: string) => void }
): string | undefined {
  const threadId = maps.subChatThreadIds.get(params.subChatId);
  if (!threadId) {
    maps.subChatSessionKeys.delete(params.subChatId);
    return undefined;
  }

  params.notifyThreadUnsubscribe?.(threadId);
  maps.activeStreamsByThreadId.delete(threadId);
  maps.activeAppServerTurns.delete(threadId);
  maps.subChatThreadIds.delete(params.subChatId);
  maps.subChatSessionKeys.delete(params.subChatId);

  for (const [turnId, mappedThreadId] of maps.activeThreadIdsByTurnId) {
    if (mappedThreadId === threadId) {
      maps.activeThreadIdsByTurnId.delete(turnId);
    }
  }

  return threadId;
}

export function unsubscribeCodexSessionThreads(
  maps: CodexThreadSubscriptionMaps,
  params: { sessionKey: string; notifyThreadUnsubscribe: (threadId: string) => void }
): string[] {
  const threadIds = new Set<string>();

  for (const [subChatId, mappedSessionKey] of maps.subChatSessionKeys) {
    if (mappedSessionKey !== params.sessionKey) continue;
    const threadId = maps.subChatThreadIds.get(subChatId);
    if (threadId) {
      threadIds.add(threadId);
    }
  }

  for (const threadId of threadIds) {
    params.notifyThreadUnsubscribe(threadId);
  }

  return [...threadIds];
}
