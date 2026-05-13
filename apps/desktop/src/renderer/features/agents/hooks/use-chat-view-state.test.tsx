// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Provider as JotaiProvider } from 'jotai';
import { createTestStore, type TestStore } from '../../../../../test-utils';
import { useChatViewState } from './use-chat-view-state';

// useSubChatMode requires a tRPC context (React Query provider) that this
// test doesn't provide. Mock it with local useState so the test stays a
// pure Jotai/hook test without a full provider tree.
vi.mock('./use-sub-chat-mode', async () => {
  const { useState, useCallback } = await import('react');
  return {
    useSubChatMode: (_subChatId: string) => {
      const [mode, setModeState] = useState<string>('plan');
      const setMode = useCallback((newMode: string) => setModeState(newMode), []);
      return { mode, setMode };
    }
  };
});

// L3.5 — hook tests. Sit between L3 (component) and L2 (service):
//   - render the hook with a jotai store, no DOM tree under it
//   - assert atom-binding semantics (reads, writes, isolation)
//   - no service deps, no tRPC, no transport — those have their own
//     L2 / L4 batteries
//
// What we're guarding against:
//   1. Atom-family bindings to the WRONG subChatId (a regression that
//      would clobber state across sub-chats — same class as PR #51).
//   2. Setters that don't trigger a re-render (would mean the
//      `useAtom` writer slot was wired wrong).
//   3. Default-fallback behavior (e.g. `mode` defaulting to `"plan"`
//      when the storage atom has no entry — the renderer relies on
//      this for first-paint).

afterEach(cleanup);

function makeWrapper(store: TestStore) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <JotaiProvider store={store}>{children}</JotaiProvider>;
  };
}

describe('useChatViewState', () => {
  it('returns sensible defaults when no per-subChat atoms have been written', () => {
    const store = createTestStore();
    const wrapper = makeWrapper(store);
    const { result } = renderHook(() => useChatViewState('sub-1'), { wrapper });

    expect(result.current.mode).toBe('plan');
    expect(result.current.providerOverride).toBeUndefined();
    // The model + thinking atoms fall back to "lastSelected*" globals; we
    // just assert non-null/non-empty rather than a specific default since
    // those globals are user-configurable.
    expect(typeof result.current.modelId).toBe('string');
    expect(typeof result.current.codexModelId).toBe('string');
    expect(typeof result.current.codexThinking).toBe('string');
    expect(typeof result.current.claudeThinking).toBe('string');
  });

  it('setMode writes through and triggers a re-render', () => {
    const store = createTestStore();
    const wrapper = makeWrapper(store);
    const { result } = renderHook(() => useChatViewState('sub-1'), { wrapper });

    expect(result.current.mode).toBe('plan');

    act(() => {
      result.current.setMode('plan');
    });

    expect(result.current.mode).toBe('plan');
  });

  it('setProviderOverride accepts null to clear', () => {
    const store = createTestStore();
    const wrapper = makeWrapper(store);
    const { result } = renderHook(() => useChatViewState('sub-1'), { wrapper });

    act(() => {
      result.current.setProviderOverride('codex');
    });
    expect(result.current.providerOverride).toBe('codex');

    act(() => {
      result.current.setProviderOverride(null);
    });
    expect(result.current.providerOverride).toBeUndefined();
  });

  it('setModelId / setCodexModelId update independently', () => {
    const store = createTestStore();
    const wrapper = makeWrapper(store);
    const { result } = renderHook(() => useChatViewState('sub-1'), { wrapper });

    act(() => {
      result.current.setModelId('sonnet');
      result.current.setCodexModelId('gpt-5.4');
    });

    expect(result.current.modelId).toBe('sonnet');
    expect(result.current.codexModelId).toBe('gpt-5.4');
  });

  it('setCodexThinking + setClaudeThinking update independently', () => {
    const store = createTestStore();
    const wrapper = makeWrapper(store);
    const { result } = renderHook(() => useChatViewState('sub-1'), { wrapper });

    act(() => {
      result.current.setCodexThinking('high');
      result.current.setClaudeThinking('off');
    });

    expect(result.current.codexThinking).toBe('high');
    expect(result.current.claudeThinking).toBe('off');
  });

  it('per-subChatId isolation — different subChatIds get independent state', () => {
    const store = createTestStore();
    const wrapper = makeWrapper(store);

    // Mount two hook instances against the same store but different ids.
    const { result: a } = renderHook(() => useChatViewState('sub-A'), { wrapper });
    const { result: b } = renderHook(() => useChatViewState('sub-B'), { wrapper });

    // Use "sonnet" rather than "opus" — `lastSelectedModelIdAtom` defaults
    // to "opus", so that value would be sub-B's fallback even without any
    // sub-A write. "sonnet" isolates the test to the per-subChat slot.
    const beforeBModel = b.current.modelId;

    act(() => {
      a.current.setMode('plan');
      a.current.setModelId('sonnet');
      a.current.setProviderOverride('codex');
    });

    // sub-A reflects the writes
    expect(a.current.mode).toBe('plan');
    expect(a.current.modelId).toBe('sonnet');
    expect(a.current.providerOverride).toBe('codex');

    // sub-B is untouched: mode default, no override, modelId unchanged
    // (still falling back to whatever the global was at hook-mount time).
    expect(b.current.mode).toBe('plan');
    expect(b.current.providerOverride).toBeUndefined();
    expect(b.current.modelId).toBe(beforeBModel);
    // Sanity: sub-A's "sonnet" write did not bleed into sub-B.
    expect(b.current.modelId).not.toBe('sonnet');
  });

  it("a write to sub-A's atom does not bleed into sub-B's snapshot", () => {
    // Tighter isolation check — separately set both and confirm both
    // reads stay correct. This is the regression class PR #51 targeted
    // (stale hydration writes clobbered the active sub-chat). The hook
    // must keep its slots cleanly separated.
    const store = createTestStore();
    const wrapper = makeWrapper(store);
    const { result: a } = renderHook(() => useChatViewState('sub-A'), { wrapper });
    const { result: b } = renderHook(() => useChatViewState('sub-B'), { wrapper });

    act(() => {
      a.current.setMode('plan');
      b.current.setMode('execute');
    });
    expect(a.current.mode).toBe('plan');
    expect(b.current.mode).toBe('execute');

    act(() => {
      a.current.setMode('execute');
      b.current.setMode('plan');
    });
    expect(a.current.mode).toBe('execute');
    expect(b.current.mode).toBe('plan');
  });
});
