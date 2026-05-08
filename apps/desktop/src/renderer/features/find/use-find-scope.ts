import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import {
  FIND_SCOPE_ACTIVE_ATTR,
  FIND_SCOPE_ATTR,
  FIND_SCOPE_CURRENT_ATTR,
  FIND_TRIGGER_EVENT,
  getCurrentFindScope,
  markCurrentFindScope
} from './constants';

export function useFindScope(scopeRef: RefObject<HTMLElement | null>, enabled: boolean) {
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  // Read isOpen via a ref inside the trigger handler so the listener wiring
  // does not have to re-attach (and the scope's data-attributes do not have
  // to flap) every time the find bar opens or closes.
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const bumpSelectionVersion = useCallback(() => {
    setSelectionVersion((version) => version + 1);
  }, []);

  // Listener wiring + attribute setup. Stable across isOpen flips.
  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;

    scope.setAttribute(FIND_SCOPE_ATTR, 'true');
    if (!scope.hasAttribute(FIND_SCOPE_CURRENT_ATTR)) {
      scope.setAttribute(FIND_SCOPE_CURRENT_ATTR, 'false');
    }

    const handleActivate = () => {
      if (!enabledRef.current) return;
      markCurrentFindScope(scope);
    };

    const handleTrigger = () => {
      if (!enabledRef.current) return;
      markCurrentFindScope(scope);
      if (isOpenRef.current) {
        setSelectionVersion((version) => version + 1);
      } else {
        setIsOpen(true);
      }
    };

    scope.addEventListener('pointerdown', handleActivate);
    scope.addEventListener('focusin', handleActivate);
    scope.addEventListener(FIND_TRIGGER_EVENT, handleTrigger);
    return () => {
      scope.removeEventListener('pointerdown', handleActivate);
      scope.removeEventListener('focusin', handleActivate);
      scope.removeEventListener(FIND_TRIGGER_EVENT, handleTrigger);
      scope.removeAttribute(FIND_SCOPE_ATTR);
      scope.removeAttribute(FIND_SCOPE_ACTIVE_ATTR);
      if (scope.getAttribute(FIND_SCOPE_CURRENT_ATTR) === 'true') {
        scope.removeAttribute(FIND_SCOPE_CURRENT_ATTR);
      }
    };
  }, [scopeRef]);

  // Active-attr maintenance + auto-claim when nothing else owns the cursor.
  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    scope.setAttribute(FIND_SCOPE_ACTIVE_ATTR, enabled ? 'true' : 'false');

    if (!enabled) {
      if (scope.getAttribute(FIND_SCOPE_CURRENT_ATTR) === 'true') {
        scope.setAttribute(FIND_SCOPE_CURRENT_ATTR, 'false');
      }
      return;
    }

    if (!getCurrentFindScope()) {
      markCurrentFindScope(scope);
    }
  }, [scopeRef, enabled]);

  return useMemo(
    () => ({
      isOpen,
      selectionVersion,
      setIsOpen,
      bumpSelectionVersion
    }),
    [bumpSelectionVersion, isOpen, selectionVersion]
  );
}
