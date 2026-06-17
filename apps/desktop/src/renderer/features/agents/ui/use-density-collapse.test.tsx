// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, act, cleanup } from '@testing-library/react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { chatMessageDensityAtom, type ChatMessageDensity } from '../../../lib/atoms';
import { resolveDensityResting, useDensityCollapse } from './use-density-collapse';

afterEach(cleanup);

describe('resolveDensityResting', () => {
  const cases: Array<[ChatMessageDensity, boolean, boolean]> = [
    // density, normalResting, expected
    ['expanded', false, true],
    ['expanded', true, true],
    ['collapsed', false, false],
    ['collapsed', true, false],
    ['default', false, false],
    ['default', true, true]
  ];
  it.each(cases)('density=%s normalResting=%s -> %s', (density, normalResting, expected) => {
    expect(resolveDensityResting(density, normalResting)).toBe(expected);
  });
});

function makeWrapper(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <JotaiProvider store={store}>{children}</JotaiProvider>;
  };
}

describe('useDensityCollapse', () => {
  it('resting follows density: collapsed=false, default(normalResting)=true, expanded=true', () => {
    const store = createStore();
    store.set(chatMessageDensityAtom, 'collapsed');
    const { result } = renderHook(() => useDensityCollapse({ normalResting: true }), {
      wrapper: makeWrapper(store)
    });
    expect(result.current.isExpanded).toBe(false);
  });

  it('forceExpanded opens by default, but a manual toggle still wins (can collapse a live card)', () => {
    const store = createStore();
    store.set(chatMessageDensityAtom, 'collapsed');
    const { result } = renderHook(() => useDensityCollapse({ forceExpanded: true }), {
      wrapper: makeWrapper(store)
    });
    // forceExpanded opens it even though density resting would be collapsed
    expect(result.current.isExpanded).toBe(true);
    // user collapses the live card
    act(() => result.current.toggle());
    expect(result.current.isExpanded).toBe(false);
  });

  it('clears the manual override when the density setting changes (reflow live)', () => {
    const store = createStore();
    store.set(chatMessageDensityAtom, 'default');
    const { result } = renderHook(() => useDensityCollapse({ normalResting: false }), {
      wrapper: makeWrapper(store)
    });
    expect(result.current.isExpanded).toBe(false);
    // user manually expands
    act(() => result.current.toggle());
    expect(result.current.isExpanded).toBe(true);
    // changing density resets the override -> snaps to the new resting state
    act(() => store.set(chatMessageDensityAtom, 'collapsed'));
    expect(result.current.isExpanded).toBe(false);
    // and to expanded when switched to 'expanded'
    act(() => store.set(chatMessageDensityAtom, 'expanded'));
    expect(result.current.isExpanded).toBe(true);
  });
});
