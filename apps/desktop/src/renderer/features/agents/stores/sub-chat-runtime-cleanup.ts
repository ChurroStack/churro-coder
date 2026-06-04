import { clearMessageStateCacheByMessageIds } from '../main/assistant-message-item';
import { clearTextPartStoreByMessageIds } from '../main/isolated-text-part';
import { clearToolStateCachesByToolCallIds } from '../ui/agent-tool-utils';
import { clearSubChatCaches } from './message-store';
import {
  currentPlanPathAtomFamily,
  planEditRefetchTriggerAtomFamily,
  currentTodosAtomFamily,
  currentTaskToolsAtomFamily
} from '../atoms';
import { planContentCacheAtomFamily } from '../../details-sidebar/atoms';

export function clearSubChatRuntimeCaches(subChatId: string) {
  const { messageIds, toolCallIds } = clearSubChatCaches(subChatId);
  clearMessageStateCacheByMessageIds(subChatId, messageIds);
  clearTextPartStoreByMessageIds(subChatId, messageIds);
  clearToolStateCachesByToolCallIds(toolCallIds);
}

/**
 * Drop the per-sub-chat sidebar atom-family instances so they don't accumulate
 * forever (atomFamily retains every key until explicitly removed). Called from
 * the sub-chat teardown path. Sub-chat ids are unique nanoids and never reused,
 * so the small storage-record entries left behind are harmless.
 */
export function clearSubChatSidebarAtoms(subChatId: string) {
  currentPlanPathAtomFamily.remove(subChatId);
  planEditRefetchTriggerAtomFamily.remove(subChatId);
  currentTodosAtomFamily.remove(subChatId);
  currentTaskToolsAtomFamily.remove(subChatId);
  planContentCacheAtomFamily.remove(subChatId);
}
