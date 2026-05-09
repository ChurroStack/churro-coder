import { useAgentSubChatStore } from '../stores/sub-chat-store';
import { normalizeAgentMode, type AgentMode } from '../atoms';

export function getCurrentSubChatMode(subChatId: string): AgentMode {
  const { allSubChats } = useAgentSubChatStore.getState();
  return normalizeAgentMode(allSubChats.find((c) => c.id === subChatId)?.mode);
}
