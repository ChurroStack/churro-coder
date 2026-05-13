import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { atomWithWindowStorage } from '../../lib/window-storage';

export type OpenSpecStep = 'proposal' | 'design' | 'tasks';

export interface PendingOpenSpecMessage {
  subChatId: string;
  message: string;
}

export interface OpenSpecSidebarContext {
  chatId: string;
  projectId: string;
  changeId: string;
  changePath: string;
}

export interface PendingChangeArchive {
  chatId: string;
  subChatId: string;
  changeId: string;
  startedAt: number;
}

/** Deferred open request written by handleSelectSpec/handleSend, consumed by
 *  ChatPanelSync once the target workspace's dockview is ready. This bridges
 *  the timing gap where the captured dockApi in the form callback still points
 *  to the old (null-workspace) dock shell after a workspace switch. */
export interface PendingOpenSpecPanel {
  subChatId: string;
  chatId: string;
  projectId: string;
  changeId: string;
  changePath?: string;
  name?: string;
}
export const pendingOpenSpecPanelAtom = atom<PendingOpenSpecPanel | null>(null);
export const pendingOpenSpecMessageAtom = atom<PendingOpenSpecMessage | null>(null);

/** Pending OpenSpec archive request keyed by change id. Memory-only; the archive folder is source of truth. */
export const pendingChangeArchiveAtomFamily = atomFamily((_changeId: string) =>
  atom<PendingChangeArchive | null>(null)
);

/** Per-workspace index so the workspace-level orchestrator can observe pending archives without dynamic atom discovery. */
export const pendingChangeArchivesByChatAtomFamily = atomFamily((_chatId: string) =>
  atom<Record<string, PendingChangeArchive>>({})
);

/** Width of the right-hand chat pane in an OpenSpec change panel. Persists per session. */
export const openSpecChangeChatWidthAtom = atomWithWindowStorage<number>('openspec:chatWidth', 360, {
  getOnInit: true
});

/** Current step (proposal / design / tasks) per change panel. Memory-only; resets on restart. */
export const openSpecChangeStepAtomFamily = atomFamily((_changeId: string) => atom<OpenSpecStep>('proposal'));

/** Bound OpenSpec sidebar context by sub-chat id. */
export const openSpecSidebarContextAtomFamily = atomFamily((_subChatId: string) =>
  atom<OpenSpecSidebarContext | null>(null)
);

/** Current editor step mirrored onto the bound sub-chat so outgoing chat turns can announce step changes. */
export const openSpecCurrentStepAtomFamily = atomFamily((_subChatId: string) => atom<OpenSpecStep>('proposal'));

/** Last step prefix sent for a sub-chat. Used to avoid repeating `[step:*]` on every turn. */
export const openSpecLastSentStepAtomFamily = atomFamily((_subChatId: string) => atom<OpenSpecStep | null>(null));

/** Optional stop handler registered by the mounted chat for this sub-chat. */
export const openSpecStopHandlerAtomFamily = atomFamily((_subChatId: string) =>
  atom<(() => Promise<void>) | null>(null)
);

/** Whether the user has visited the tasks step in this session, for the '· may regen' warning. Memory-only. */
export const openSpecVisitedTasksAtomFamily = atomFamily((_changeId: string) => atom<boolean>(false));

/** When true, the next outgoing message for this sub-chat skips step-prefix injection.
 *  Notch actions (mergeBase, createPr) set this so their workflow prompts don't pick up [step:proposal] etc. */
export const openSpecSkipNextStepPrefixAtomFamily = atomFamily((_subChatId: string) => atom<boolean>(false));

/** When true, every outgoing message for this sub-chat is auto-prefixed with `/opsx:apply `.
 *  Lets users stay in "fix issues" mode without retyping /opsx:apply each turn. Resets to false on app reload. */
export const openSpecApplyModeAtomFamily = atomFamily((_subChatId: string) => atom<boolean>(false));
