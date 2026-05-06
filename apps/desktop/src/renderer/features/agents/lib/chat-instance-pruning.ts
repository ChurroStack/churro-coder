import { agentChatStore } from '../stores/agent-chat-store';

type RuntimeCacheClearer = (subChatId: string) => void;

export function evictChatsForParentChatSwitch(
  previousParentChatId: string | null,
  nextParentChatId: string,
  clearRuntimeCachesForSubChat: RuntimeCacheClearer
) {
  if (!previousParentChatId || previousParentChatId === nextParentChatId) return;

  for (const subChatId of agentChatStore.keys()) {
    if (agentChatStore.getParentChatId(subChatId) !== previousParentChatId) continue;
    agentChatStore.evict(subChatId);
    clearRuntimeCachesForSubChat(subChatId);
  }
}

export function evictInactiveChatsForWorkspace(
  parentChatId: string,
  keepSubChatIds: Iterable<string>,
  clearRuntimeCachesForSubChat: RuntimeCacheClearer
) {
  const keep = new Set(keepSubChatIds);
  for (const subChatId of agentChatStore.keys()) {
    if (agentChatStore.getParentChatId(subChatId) !== parentChatId) continue;
    if (keep.has(subChatId)) continue;
    agentChatStore.evict(subChatId);
    clearRuntimeCachesForSubChat(subChatId);
  }
}
