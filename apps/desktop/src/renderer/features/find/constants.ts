export const FIND_SCOPE_ATTR = 'data-find-scope';
export const FIND_SCOPE_ACTIVE_ATTR = 'data-find-scope-active';
export const FIND_SCOPE_CURRENT_ATTR = 'data-find-scope-current';
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
  const currentScope = getCurrentFindScope();
  if (currentScope && isVisible(currentScope)) {
    return currentScope;
  }

  const scopes = Array.from(document.querySelectorAll<HTMLElement>(`[${FIND_SCOPE_ACTIVE_ATTR}="true"]`)).filter(
    isVisible
  );
  return scopes.at(-1) ?? null;
}

export function getCurrentFindScope(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${FIND_SCOPE_CURRENT_ATTR}="true"]`);
}

export function markCurrentFindScope(scope: HTMLElement | null) {
  if (!scope) return;

  // If a descendant scope already holds current, an ancestor scope must not
  // yank it away. Bubbling pointerdown / focusin listeners would otherwise
  // hand the claim back to the outermost scope on every interaction.
  const existing = getCurrentFindScope();
  if (existing && existing !== scope && scope.contains(existing)) {
    return;
  }

  const currentScopes = document.querySelectorAll<HTMLElement>(`[${FIND_SCOPE_CURRENT_ATTR}="true"]`);
  currentScopes.forEach((element) => {
    if (element !== scope) {
      element.setAttribute(FIND_SCOPE_CURRENT_ATTR, 'false');
    }
  });

  scope.setAttribute(FIND_SCOPE_CURRENT_ATTR, 'true');
}

export function dispatchFindToScope(scope: HTMLElement | null): boolean {
  if (!scope) return false;
  scope.dispatchEvent(new CustomEvent(FIND_TRIGGER_EVENT, { bubbles: false }));
  return true;
}
