import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { atomWithWindowStorage } from '../../lib/window-storage';

export type OpenSpecStep = 'proposal' | 'design' | 'tasks';

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

/** Width of the right-hand chat pane in an OpenSpec change panel. Persists per session. */
export const openSpecChangeChatWidthAtom = atomWithWindowStorage<number>('openspec:chatWidth', 360, {
  getOnInit: true
});

/** Current step (proposal / design / tasks) per change panel. Memory-only; resets on restart. */
export const openSpecChangeStepAtomFamily = atomFamily((_changeId: string) => atom<OpenSpecStep>('proposal'));

/** Whether the user has visited the tasks step in this session, for the '· may regen' warning. Memory-only. */
export const openSpecVisitedTasksAtomFamily = atomFamily((_changeId: string) => atom<boolean>(false));
