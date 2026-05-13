import { atom } from 'jotai';
import { nanoid } from 'nanoid';

export type NewProjectSection = 'create' | 'open' | 'clone';

export interface NewProjectDraft {
  provider: 'github' | 'azure' | 'local';
  accountId: string;
  projectId?: string;
  name: string;
  description: string;
  visibility?: 'public' | 'private';
  openspecInit: boolean;
  prompt: string;
  correlationId: string;
}

export type StepStatus = 'idle' | 'pending' | 'done' | 'error';

export interface NewProjectProgress {
  validate: StepStatus;
  'remote-create': StepStatus;
  clone: StepStatus;
  scaffold: StepStatus;
  commit: StepStatus;
  push: StepStatus;
  'db-insert': StepStatus;
  'chat-create': StepStatus;
  'worktree-create': StepStatus;
  'openspec-init': StepStatus;
  lastError?: string;
}

function freshDraft(): NewProjectDraft {
  return {
    provider: 'github',
    accountId: '',
    name: '',
    description: '',
    openspecInit: false,
    prompt: '',
    correlationId: nanoid()
  };
}

function freshProgress(): NewProjectProgress {
  return {
    validate: 'idle',
    'remote-create': 'idle',
    clone: 'idle',
    scaffold: 'idle',
    commit: 'idle',
    push: 'idle',
    'db-insert': 'idle',
    'chat-create': 'idle',
    'worktree-create': 'idle',
    'openspec-init': 'idle'
  };
}

export const newProjectDialogOpenAtom = atom(false);
export const newProjectActiveSectionAtom = atom<NewProjectSection>('create');
export const newProjectDraftAtom = atom<NewProjectDraft>(freshDraft());
export const newProjectProgressAtom = atom<NewProjectProgress>(freshProgress());

/** Reset draft and progress (called after successful creation or dialog close). */
export const resetNewProjectAtom = atom(null, (_get, set) => {
  set(newProjectDraftAtom, freshDraft());
  set(newProjectProgressAtom, freshProgress());
  set(newProjectActiveSectionAtom, 'create');
});
