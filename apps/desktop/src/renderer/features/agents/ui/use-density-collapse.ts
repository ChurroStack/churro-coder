import { useCallback, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { chatMessageDensityAtom, type ChatMessageDensity } from '../../../lib/atoms';

/**
 * Pure resolver: given the current density and a component's "default-mode" resting
 * expansion, return whether the component should be expanded at rest.
 *  - 'expanded'  → always expanded
 *  - 'collapsed' → always collapsed
 *  - 'default'   → the component's own default-mode behavior
 *
 * Exported separately so it can be unit-tested without React.
 */
export function resolveDensityResting(density: ChatMessageDensity, normalResting: boolean): boolean {
  if (density === 'expanded') return true;
  if (density === 'collapsed') return false;
  return normalResting;
}

interface UseDensityCollapseOptions {
  /** Resting expansion in 'default' density (what the component used before this setting). */
  normalResting?: boolean;
  /**
   * Force-open the card regardless of density (e.g. while a turn is streaming so live
   * progress stays visible). A manual user toggle still wins over this — see below.
   */
  forceExpanded?: boolean;
}

interface UseDensityCollapseResult {
  density: ChatMessageDensity;
  isExpanded: boolean;
  toggle: () => void;
  /**
   * Whether a card's main body/content should render. False in 'collapsed' density until
   * the user expands it (title-only); always true otherwise. Centralizes the
   * `density !== 'collapsed' || isExpanded` rule every card used to re-derive.
   */
  showContent: boolean;
  /**
   * Whether a card's inline preview/subtitle should render. False in 'collapsed' density
   * (title only); true otherwise. Centralizes the `density !== 'collapsed'` preview rule.
   */
  showPreview: boolean;
}

/**
 * Shared expand/collapse state driven by the global chat-message-density setting.
 *
 * Behavior:
 *  - The resting state comes from {@link resolveDensityResting}.
 *  - A manual toggle stores an override that beats both the resting default AND
 *    `forceExpanded`, so the user can always collapse a live streaming card.
 *  - The override is scoped to the density it was made under, so when the density setting
 *    changes the whole transcript reflows live to the new density (no effect / extra render).
 */
export function useDensityCollapse(opts?: UseDensityCollapseOptions): UseDensityCollapseResult {
  const density = useAtomValue(chatMessageDensityAtom);
  const resting = resolveDensityResting(density, opts?.normalResting ?? false);
  const base = opts?.forceExpanded ? true : resting;

  // Manual override tagged with the density it was made under. When the density setting
  // changes, the tag no longer matches and the override is ignored → live reflow without
  // a useEffect (which would cost a second render per card across the transcript).
  const [override, setOverride] = useState<{ value: boolean; density: ChatMessageDensity } | null>(null);
  const effectiveOverride = override && override.density === density ? override.value : null;

  const isExpanded = effectiveOverride ?? base;

  // Stable toggle: reads the latest resolved state + density via refs so callers can
  // memoize handlers that depend on it without re-creating them every render.
  const isExpandedRef = useRef(isExpanded);
  isExpandedRef.current = isExpanded;
  const densityRef = useRef(density);
  densityRef.current = density;
  const toggle = useCallback(() => {
    setOverride({ value: !isExpandedRef.current, density: densityRef.current });
  }, []);

  return {
    density,
    isExpanded,
    toggle,
    showContent: density !== 'collapsed' || isExpanded,
    showPreview: density !== 'collapsed'
  };
}
