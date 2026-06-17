import { useCallback, useEffect, useRef, useState } from 'react';
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
}

/**
 * Shared expand/collapse state driven by the global chat-message-density setting.
 *
 * Behavior:
 *  - The resting state comes from {@link resolveDensityResting}.
 *  - A manual toggle stores an override that beats both the resting default AND
 *    `forceExpanded`, so the user can always collapse a live streaming card.
 *  - When the density setting changes, the override is cleared so the whole transcript
 *    reflows live to the new density.
 */
export function useDensityCollapse(opts?: UseDensityCollapseOptions): UseDensityCollapseResult {
  const density = useAtomValue(chatMessageDensityAtom);
  const resting = resolveDensityResting(density, opts?.normalResting ?? false);
  const base = opts?.forceExpanded ? true : resting;

  // null = follow `base`; boolean = explicit user override.
  const [override, setOverride] = useState<boolean | null>(null);

  // Reflow live: clear any manual override whenever the density setting changes.
  useEffect(() => {
    setOverride(null);
  }, [density]);

  const isExpanded = override ?? base;

  // Stable toggle: reads the latest resolved state via a ref so callers can memoize
  // handlers that depend on it without re-creating them every render.
  const isExpandedRef = useRef(isExpanded);
  isExpandedRef.current = isExpanded;
  const toggle = useCallback(() => {
    setOverride(!isExpandedRef.current);
  }, []);

  return { density, isExpanded, toggle };
}
