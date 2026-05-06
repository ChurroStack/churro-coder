import { agentChatStore } from '../stores/agent-chat-store';
import { useStreamingStatusStore } from '../stores/streaming-status-store';
import { useMessageQueueStore } from '../stores/message-queue-store';

type RuntimeCacheClearer = (subChatId: string) => void;

// Preserve sub-chats with an in-flight stream or pending queued messages so a
// workspace switch never tears down their renderer-side state mid-stream.
// Without this, evict + clearRuntimeCachesForSubChat drop the AI SDK Chat
// instance and message store while the backend is still emitting chunks,
// orphaning the IPC subscription and losing everything not yet persisted.
function describeLiveWork(subChatId: string): { live: boolean; streaming: boolean; queued: number } {
  const status = useStreamingStatusStore.getState().getStatus(subChatId);
  const streaming = status === 'streaming' || status === 'submitted';
  const queued = useMessageQueueStore.getState().queues[subChatId]?.length ?? 0;
  return { live: streaming || queued > 0, streaming, queued };
}

function hasLiveWork(subChatId: string): boolean {
  return describeLiveWork(subChatId).live;
}

export function evictChatsForParentChatSwitch(
  previousParentChatId: string | null,
  nextParentChatId: string,
  clearRuntimeCachesForSubChat: RuntimeCacheClearer
) {
  if (!previousParentChatId || previousParentChatId === nextParentChatId) return;

  console.log(
    `[SD] R:EVICT_PARENT_SWITCH prev=${previousParentChatId.slice(-8)} next=${nextParentChatId.slice(-8)} candidates=${agentChatStore.keys().length}`
  );

  for (const subChatId of agentChatStore.keys()) {
    if (agentChatStore.getParentChatId(subChatId) !== previousParentChatId) continue;
    const work = describeLiveWork(subChatId);
    if (work.live) {
      console.log(
        `[SD] R:EVICT_KEEP sub=${subChatId.slice(-8)} reason=${work.streaming ? 'streaming' : 'queued'} streaming=${work.streaming} queued=${work.queued}`
      );
      continue;
    }
    console.log(`[SD] R:EVICT_DROP sub=${subChatId.slice(-8)} reason=parent_switch`);
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
    const work = describeLiveWork(subChatId);
    if (work.live) {
      console.log(
        `[SD] R:EVICT_INACTIVE_KEEP sub=${subChatId.slice(-8)} reason=${work.streaming ? 'streaming' : 'queued'} streaming=${work.streaming} queued=${work.queued}`
      );
      continue;
    }
    console.log(`[SD] R:EVICT_INACTIVE_DROP sub=${subChatId.slice(-8)} parent=${parentChatId.slice(-8)}`);
    agentChatStore.evict(subChatId);
    clearRuntimeCachesForSubChat(subChatId);
  }
}
