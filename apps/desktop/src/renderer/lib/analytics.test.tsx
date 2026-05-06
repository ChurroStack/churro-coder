// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Provider as JotaiProvider, atom } from 'jotai';
import { render, waitFor, cleanup } from '@testing-library/react';

const scopeSetTag = vi.fn();

vi.mock('@sentry/electron/renderer', () => ({
  getCurrentScope: () => ({ setTag: scopeSetTag }),
  setTag: vi.fn(),
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  captureFeedback: vi.fn(),
  addBreadcrumb: vi.fn(),
  close: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({})),
  consoleLoggingIntegration: vi.fn(() => ({}))
}));

vi.mock('../features/agents/atoms', () => ({
  selectedAgentChatIdAtom: atom<string | null>(null)
}));

vi.mock('../features/agents/stores/sub-chat-store', () => {
  let activeSubChatId: string | null = null;
  const useAgentSubChatStore = ((selector: (state: { activeSubChatId: string | null }) => unknown) =>
    selector({ activeSubChatId })) as typeof import('../features/agents/stores/sub-chat-store').useAgentSubChatStore;
  useAgentSubChatStore.setState = (state: { activeSubChatId: string | null }) => {
    activeSubChatId = state.activeSubChatId;
  };
  return { useAgentSubChatStore };
});

import { appStore } from './jotai-store';
import { sanitizeRendererLogForSend, useSentryWorkspaceTags } from './analytics';
import { selectedAgentChatIdAtom } from '../features/agents/atoms';
import { useAgentSubChatStore } from '../features/agents/stores/sub-chat-store';

function HookHarness() {
  useSentryWorkspaceTags();
  return null;
}

afterEach(() => {
  cleanup();
  scopeSetTag.mockReset();
  appStore.set(selectedAgentChatIdAtom, null);
  useAgentSubChatStore.setState({ activeSubChatId: null });
});

describe('useSentryWorkspaceTags', () => {
  test('writes workspace and subchat tags to the current scope', async () => {
    appStore.set(selectedAgentChatIdAtom, 'workspace-1');
    useAgentSubChatStore.setState({ activeSubChatId: 'subchat-1' });

    render(
      <JotaiProvider store={appStore}>
        <HookHarness />
      </JotaiProvider>
    );

    await waitFor(() => {
      expect(scopeSetTag).toHaveBeenCalledWith('workspace_id', 'workspace-1');
      expect(scopeSetTag).toHaveBeenCalledWith('subchat_id', 'subchat-1');
    });
  });
});

describe('sanitizeRendererLogForSend', () => {
  test('keeps string messages as strings while redacting sensitive values', () => {
    const sanitized = sanitizeRendererLogForSend({
      level: 'error',
      message: 'failed for user@example.com',
      attributes: { token: 'Bearer abcdefghijklmnopqrstuvwxyz123456' }
    });

    expect(sanitized?.message).toBe('failed for [EMAIL]');
    expect(JSON.stringify(sanitized?.attributes)).not.toContain('Bearer abcdefghijklmnopqrstuvwxyz123456');
  });
});
