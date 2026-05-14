import { atomFamily } from 'jotai/utils';
import { atom } from 'jotai';

/** Stores a pending initial prompt keyed by chatId. Read once by the chat input to pre-populate. */
export const pendingInitialPromptAtom = atomFamily((chatId: string) => atom<string>(''));

/**
 * Singleton pending prompt set by the New Project wizard when the user lands on
 * the "New workspace" screen after a project is created. The new-chat-form reads
 * it once on mount, pre-fills its editor, then clears the atom so future visits
 * start empty.
 */
export const pendingNewWorkspacePromptAtom = atom<string>('');
