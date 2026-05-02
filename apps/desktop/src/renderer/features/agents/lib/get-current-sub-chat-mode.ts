import { appStore } from "../../../lib/jotai-store"
import { subChatModeAtomFamily, type AgentMode } from "../atoms"

export function getCurrentSubChatMode(subChatId: string): AgentMode {
  return appStore.get(subChatModeAtomFamily(subChatId))
}
