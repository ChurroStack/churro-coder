// Synthesize the minimum getSubChat shape so the optimistic mode write
// is never a no-op. The only reader that depends on this entry today is
// useSubChatMode, which reads `.mode`. Other fields (chatId, name) are
// filled from the Zustand store when available so a stale background
// fetch can later replace this with the real row without consumer churn.
import { useAgentSubChatStore } from '../stores/sub-chat-store';
import type { AgentMode } from '../atoms';

export function applyModeToSubChatCacheEntry<T extends { id: string; mode: AgentMode } | null | undefined>(
  prev: T,
  id: string,
  mode: AgentMode
): NonNullable<T> {
  if (prev) return { ...prev, mode } as NonNullable<T>;
  const store = useAgentSubChatStore.getState().allSubChats.find((sc) => sc.id === id);
  // as unknown as cast is intentional: useSubChatMode only reads .mode from this entry.
  // A real background fetch overwrites the synthetic with the full row shortly after.
  return {
    id,
    chatId: store?.chatId ?? '',
    name: store?.name ?? null,
    mode,
    messages: [],
    chat: null
  } as unknown as NonNullable<T>;
}
