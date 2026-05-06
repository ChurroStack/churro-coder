import { agentChatStore } from '../stores/agent-chat-store';
import { useStreamingStatusStore } from '../stores/streaming-status-store';
import { useMessageQueueStore } from '../stores/message-queue-store';

type RuntimeCacheClearer = (subChatId: string) => void;

// Preserve sub-chats with an in-flight stream or pending queued messages so a
// workspace switch never tears down their renderer-side state mid-stream.
// Without this, evict + clearRuntimeCachesForSubChat drop the AI SDK Chat
// instance and message store while the backend is still emitting chunks,
// orphaning the IPC subscription and losing everything not yet persisted.
function hasLiveWork(subChatId: string): boolean {
  if (useStreamingStatusStore.getState().isStreaming(subChatId)) return true;
  if ((useMessageQueueStore.getState().queues[subChatId]?.length ?? 0) > 0) return true;
  return false;
}

export function evictChatsForParentChatSwitch(
  previousParentChatId: string | null,
  nextParentChatId: string,
  clearRuntimeCachesForSubChat: RuntimeCacheClearer
) {
  if (!previousParentChatId || previousParentChatId === nextParentChatId) return;

  for (const subChatId of agentChatStore.keys()) {
    if (agentChatStore.getParentChatId(subChatId) !== previousParentChatId) continue;
    if (hasLiveWork(subChatId)) continue;
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
    if (hasLiveWork(subChatId)) continue;
    agentChatStore.evict(subChatId);
    clearRuntimeCachesForSubChat(subChatId);
  }
}
