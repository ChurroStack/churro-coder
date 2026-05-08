// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
import { cleanup, render } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
import { createTestStore, type TestStore } from '../../test-utils/create-test-store';
import {
  anthropicOnboardingCompletedAtom,
  apiKeyOnboardingCompletedAtom,
  billingMethodAtom,
  codexOnboardingCompletedAtom,
  selectedAgentChatIdAtom,
  selectedProjectAtom
} from './lib/atoms';

const projectsListMock = vi.fn();
const chatsGetProjectIdByIdMock = vi.fn();

vi.mock('./lib/trpc', () => ({
  trpc: {
    codex: {
      getChurroCoderMcpStatus: { useQuery: () => ({ data: undefined }) }
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
    chatsGetProjectIdByIdMock.mockReset();
    chatsGetProjectIdByIdMock.mockReturnValue({ data: undefined });
  });

  it('does not show the SelectRepoPage when projects exist and selectedProject is null', async () => {
    const store = createTestStore();
    seedOnboarding(store);
    projectsListMock.mockReturnValue({
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
    });

    const { findByText, queryByText } = mountAppContent(store);
    await findByText('Agents Layout');
    expect(queryByText('Select a repository')).toBeNull();
  });

  it('shows the SelectRepoPage when DB has no projects', async () => {
    const store = createTestStore();
    seedOnboarding(store);
    projectsListMock.mockReturnValue({ data: [], isLoading: false });

    const { findByText } = mountAppContent(store);
    await findByText('Select a repository');
  });
});
