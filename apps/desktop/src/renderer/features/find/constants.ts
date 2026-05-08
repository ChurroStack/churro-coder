export const FIND_SCOPE_ATTR = 'data-find-scope';
export const FIND_SCOPE_ACTIVE_ATTR = 'data-find-scope-active';
export const FIND_TRIGGER_EVENT = 'churro-find-trigger';

function isVisible(element: Element): element is HTMLElement {
  return element instanceof HTMLElement && element.getClientRects().length > 0;
}

export function getNearestFindScope(element: Element | null): HTMLElement | null {
  if (!element) return null;
  const scope = element.closest<HTMLElement>(`[${FIND_SCOPE_ATTR}]`);
  return scope && isVisible(scope) ? scope : null;
}

export function getActiveFindScope(): HTMLElement | null {
  const scopes = Array.from(document.querySelectorAll<HTMLElement>(`[${FIND_SCOPE_ACTIVE_ATTR}="true"]`)).filter(
    isVisible
  );
  return scopes.at(-1) ?? null;
}

export function dispatchFindToScope(scope: HTMLElement | null): boolean {
  if (!scope) return false;
  scope.dispatchEvent(new CustomEvent(FIND_TRIGGER_EVENT, { bubbles: false }));
  return true;
}
