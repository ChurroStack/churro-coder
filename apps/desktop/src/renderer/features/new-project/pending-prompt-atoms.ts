import { atomFamily } from 'jotai/utils';
import { atom } from 'jotai';

/** Stores a pending initial prompt keyed by chatId. Read once by the chat input to pre-populate. */
export const pendingInitialPromptAtom = atomFamily((chatId: string) => atom<string>(''));
