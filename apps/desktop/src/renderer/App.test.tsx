// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
import { cleanup, render } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
import { createTestStore, type TestStore } from '../../test-utils/create-test-store';
import { toast } from 'sonner';
import {
  anthropicOnboardingCompletedAtom,
  apiKeyOnboardingCompletedAtom,
  billingMethodAtom,
  codexOnboardingCompletedAtom,
  selectedAgentChatIdAtom,
  selectedProjectAtom
} from './lib/atoms';

const projectsListMock = vi.fn();
const refetchProjectsMock = vi.fn();
const chatsGetProjectIdByIdMock = vi.fn();
let churroMcpStatusResult: { data: unknown } = { data: undefined };

vi.mock('./lib/trpc', () => ({
  trpc: {
    codex: {
      getChurroCoderMcpStatus: { useQuery: () => churroMcpStatusResult }
    },
    claudeCode: {
      hasExistingCliConfig: { useQuery: () => ({ data: undefined, isLoading: false }) }
    },
    projects: {
      list: { useQuery: (...args: unknown[]) => projectsListMock(...args) }
    },
    chats: {
      getProjectIdById: { useQuery: (...args: unknown[]) => chatsGetProjectIdByIdMock(...args) }
    }
  },
  trpcClient: {
    analytics: { setDebugSession: { mutate: vi.fn(() => Promise.resolve()) } },
    chats: { deleteEmptySubChatsByIds: { mutate: vi.fn(() => Promise.resolve()) } }
  }
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  }
}));

vi.mock('./contexts/WindowContext', () => ({
  WindowProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  getInitialWindowParams: () => ({}),
  useWindowId: () => 'main',
  getWindowId: () => 'main'
}));

vi.mock('./features/agents/stores/sub-chat-store', () => ({
  useAgentSubChatStore: Object.assign(
    vi.fn(() => ({
      setActiveSubChat: vi.fn(),
      addToOpenSubChats: vi.fn(),
      setChatId: vi.fn()
    })),
    { getState: () => ({ openSubChatIds: [] }) }
  )
}));

vi.mock('./features/onboarding', () => ({
  AnthropicOnboardingPage: () => <div>Anthropic Onboarding</div>,
  ApiKeyOnboardingPage: () => <div>API Key Onboarding</div>,
  BillingMethodPage: () => <div>Billing Method</div>,
  CodexOnboardingPage: () => <div>Codex Onboarding</div>,
  SelectRepoPage: () => <div>Select a repository</div>
}));

vi.mock('./features/layout/agents-layout', () => ({
  AgentsLayout: () => <div>Agents Layout</div>
}));

import { AppContent } from './App';

function seedOnboarding(store: TestStore) {
  store.set(billingMethodAtom, 'api-key');
  store.set(apiKeyOnboardingCompletedAtom, true);
  store.set(anthropicOnboardingCompletedAtom, true);
  store.set(codexOnboardingCompletedAtom, true);
  store.set(selectedProjectAtom, null);
  store.set(selectedAgentChatIdAtom, null);
}

function mountAppContent(store: TestStore) {
  return render(
    <JotaiProvider store={store}>
      <AppContent />
    </JotaiProvider>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('AppContent — project-page decision', () => {
  beforeEach(() => {
    projectsListMock.mockReset();
    refetchProjectsMock.mockReset();
    chatsGetProjectIdByIdMock.mockReset();
    chatsGetProjectIdByIdMock.mockReturnValue({ data: undefined });
    churroMcpStatusResult = { data: undefined };
    vi.mocked(toast.error).mockClear();
  });

  function projectsResult(override: { data: unknown; isLoading: boolean }) {
    return { ...override, refetch: refetchProjectsMock };
  }

  it('does not show the SelectRepoPage when projects exist and selectedProject is null', async () => {
    const store = createTestStore();
    seedOnboarding(store);
    projectsListMock.mockReturnValue(
      projectsResult({
        data: [
          {
            id: 'p1',
            name: 'Alpha',
            path: '/alpha',
            gitRemoteUrl: null,
            gitProvider: 'github',
            gitOwner: 'a',
            gitRepo: 'alpha'
          }
        ],
        isLoading: false
      })
    );

    const { findByText, queryByText } = mountAppContent(store);
    await findByText('Agents Layout');
    expect(queryByText('Select a repository')).toBeNull();
  });

  it('shows the SelectRepoPage when DB has no projects', async () => {
    const store = createTestStore();
    seedOnboarding(store);
    projectsListMock.mockReturnValue(projectsResult({ data: [], isLoading: false }));

    const { findByText } = mountAppContent(store);
    await findByText('Select a repository');
  });

  it('renders AgentsLayout when localStorage selectedProject points at a deleted project but DB has others', async () => {
    const store = createTestStore();
    seedOnboarding(store);
    store.set(selectedProjectAtom, {
      id: 'deleted-id',
      name: 'Old',
      path: '/old',
      gitRemoteUrl: null,
      gitProvider: 'github',
      gitOwner: 'a',
      gitRepo: 'old'
    });
    projectsListMock.mockReturnValue(
      projectsResult({
        data: [
          {
            id: 'p1',
            name: 'Alpha',
            path: '/alpha',
            gitRemoteUrl: null,
            gitProvider: 'github',
            gitOwner: 'a',
            gitRepo: 'alpha'
          }
        ],
        isLoading: false
      })
    );
    const { findByText, queryByText } = mountAppContent(store);
    await findByText('Agents Layout');
    expect(queryByText('Select a repository')).toBeNull();
  });

  it('falls back to most-recent when selectedChatId points at a deleted chat (getProjectIdById returns null)', async () => {
    const store = createTestStore();
    seedOnboarding(store);
    store.set(selectedAgentChatIdAtom, 'stale-chat-id');
    projectsListMock.mockReturnValue(
      projectsResult({
        data: [
          {
            id: 'p1',
            name: 'Alpha',
            path: '/alpha',
            gitRemoteUrl: null,
            gitProvider: 'github',
            gitOwner: 'a',
            gitRepo: 'alpha'
          }
        ],
        isLoading: false
      })
    );
    chatsGetProjectIdByIdMock.mockReturnValue({ data: null }); // chat row deleted
    const { findByText, queryByText } = mountAppContent(store);
    await findByText('Agents Layout');
    expect(queryByText('Select a repository')).toBeNull();
  });

  it('trusts localStorage and triggers refetch when projects.list resolves to a non-array shape', async () => {
    const store = createTestStore();
    seedOnboarding(store);
    store.set(selectedProjectAtom, {
      id: 'p1',
      name: 'Alpha',
      path: '/alpha',
      gitRemoteUrl: null,
      gitProvider: 'github',
      gitOwner: 'a',
      gitRepo: 'alpha'
    });
    // Simulate the bug: projects.list resolved with a non-array value.
    projectsListMock.mockReturnValue(projectsResult({ data: { hasConfig: false }, isLoading: false }));
    const { findByText, queryByText } = mountAppContent(store);
    // localStorage project is trusted while the corrected refetch is in flight
    await findByText('Agents Layout');
    expect(queryByText('Select a repository')).toBeNull();
    // defensive refetch must have been triggered
    expect(refetchProjectsMock).toHaveBeenCalled();
  });

  it('re-fires the Codex MCP failure toast only when status flips into failed', async () => {
    const store = createTestStore();
    seedOnboarding(store);
    projectsListMock.mockReturnValue(projectsResult({ data: [], isLoading: false }));

    churroMcpStatusResult = {
      data: {
        state: 'failed',
        serverName: 'churro-coder-dev',
        error: 'bootstrap failed'
      }
    };

    const view = mountAppContent(store);
    expect(toast.error).toHaveBeenCalledTimes(1);

    churroMcpStatusResult = {
      data: {
        state: 'ready',
        serverName: 'churro-coder-dev',
        url: 'http://127.0.0.1:5555/'
      }
    };
    view.rerender(
      <JotaiProvider store={store}>
        <AppContent />
      </JotaiProvider>
    );
    expect(toast.error).toHaveBeenCalledTimes(1);

    churroMcpStatusResult = {
      data: {
        state: 'failed',
        serverName: 'churro-coder-dev',
        error: 'failed again'
      }
    };
    view.rerender(
      <JotaiProvider store={store}>
        <AppContent />
      </JotaiProvider>
    );
    expect(toast.error).toHaveBeenCalledTimes(2);
  });
});
