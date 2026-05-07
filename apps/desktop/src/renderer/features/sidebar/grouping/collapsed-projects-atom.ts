import { atomWithStorage } from 'jotai/utils';

export const collapsedProjectsAtom = atomWithStorage<Record<string, boolean>>('sidebar:collapsed-projects', {});
