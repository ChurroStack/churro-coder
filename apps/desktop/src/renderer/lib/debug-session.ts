import { atom } from 'jotai';
import { appStore } from './jotai-store';

export const debugSessionEnabledAtom = atom<boolean>(false);

export function isDebugSession(): boolean {
  return appStore.get(debugSessionEnabledAtom);
}
