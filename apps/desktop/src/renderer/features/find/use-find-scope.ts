import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

import { FIND_SCOPE_ACTIVE_ATTR, FIND_SCOPE_ATTR, FIND_TRIGGER_EVENT } from './constants';

export function useFindScope(scopeRef: RefObject<HTMLElement | null>, enabled: boolean) {
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;

    scope.setAttribute(FIND_SCOPE_ATTR, 'true');
    scope.setAttribute(FIND_SCOPE_ACTIVE_ATTR, enabled ? 'true' : 'false');

    const handleTrigger = () => {
      if (!enabled) return;
      if (isOpen) {
        setSelectionVersion((version) => version + 1);
      } else {
        setIsOpen(true);
      }
    };

    scope.addEventListener(FIND_TRIGGER_EVENT, handleTrigger);
    return () => {
      scope.removeEventListener(FIND_TRIGGER_EVENT, handleTrigger);
      scope.removeAttribute(FIND_SCOPE_ATTR);
      scope.removeAttribute(FIND_SCOPE_ACTIVE_ATTR);
    };
  }, [scopeRef, enabled, isOpen]);

  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    scope.setAttribute(FIND_SCOPE_ACTIVE_ATTR, enabled ? 'true' : 'false');
  }, [scopeRef, enabled]);

  return {
    isOpen,
    selectionVersion,
    setIsOpen,
    bumpSelectionVersion: () => setSelectionVersion((version) => version + 1)
  };
}
