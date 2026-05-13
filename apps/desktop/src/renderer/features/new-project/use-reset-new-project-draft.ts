import { useSetAtom } from 'jotai';
import { resetNewProjectAtom } from './atoms';

export function useResetNewProjectDraft() {
  return useSetAtom(resetNewProjectAtom);
}
