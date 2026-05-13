import { appStore } from '../../../lib/jotai-store';
import { bumpSessionEpoch } from '../atoms';
import { openSpecSidebarContextAtomFamily } from '../../openspec/atoms';
import { markCodexFreshNextTurn } from './codex-chat-transport';

export function forceFreshSubChatSession(subChatId: string): void {
  bumpSessionEpoch(subChatId, 'claude-code', appStore.set);
  bumpSessionEpoch(subChatId, 'codex', appStore.set);
  markCodexFreshNextTurn(subChatId);
}

export function forceFreshSubChatSessionIfOpenSpec(subChatId: string): boolean {
  if (!appStore.get(openSpecSidebarContextAtomFamily(subChatId))) return false;
  forceFreshSubChatSession(subChatId);
  return true;
}
