// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'jotai';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { createTestStore } from '../../../../../test-utils/create-test-store';
import {
  agentsSidebarOpenAtom,
  selectedAgentChatIdAtom,
  desktopViewAtom,
  projectStatsTargetIdAtom,
  selectedProjectAtom
} from '../../../lib/atoms';
import { newWorkspaceFormKeyAtom, selectedDraftIdAtom, showNewChatFormAtom } from '../../agents/atoms';
import { ProjectGroupActionsMenu } from './project-group-actions-menu';

afterEach(cleanup);

vi.mock('../../../components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled
  }: PropsWithChildren<{ onClick?: () => void; disabled?: boolean }>) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>
}));

const createChatMutateAsync = vi.fn().mockResolvedValue({ id: 'new-local-chat' });
const listFetch = vi.fn().mockResolvedValue([]);

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      chats: { list: { invalidate: vi.fn(), fetch: listFetch } },
      projects: { list: { invalidate: vi.fn() } }
    }),
    external: {
      openInApp: { useMutation: () => ({ mutate: vi.fn() }) },
      openInFinder: { useMutation: () => ({ mutate: vi.fn() }) }
    },
    chats: {
      archiveBatch: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      create: { useMutation: () => ({ mutateAsync: createChatMutateAsync, isPending: false }) }
    },
    projects: {
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) }
    }
  }
}));

vi.mock('../../../components/open-in-menu-items', () => ({
  OpenInMenuItems: () => null,
  getAppOption: () => ({ id: 'vscode', label: 'VS Code', displayLabel: null })
}));

vi.mock('./project-group-header', () => ({
  ProjectGroupMenuButton: ({ onClick }: { onClick?: (e: React.MouseEvent) => void }) => (
    <button type="button" onClick={onClick} aria-label="Open menu">
      ···
    </button>
  )
}));

const project = {
  id: 'proj-42',
  name: 'My App',
  path: '/home/user/my-app',
  gitRemoteUrl: null,
  gitProvider: null,
  gitOwner: null,
  gitRepo: null
};

describe('ProjectGroupActionsMenu', () => {
  beforeEach(() => {
    createChatMutateAsync.mockClear();
    listFetch.mockClear();
    listFetch.mockResolvedValue([]);
  });

  it('Open local workspace creates one Local chat even on rapid double-click', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ProjectGroupActionsMenu project={project as any} chatIds={[]} />
      </Provider>
    );

    const item = screen.getByText(/open local workspace/i);
    fireEvent.click(item);
    fireEvent.click(item);

    await waitFor(() => expect(createChatMutateAsync).toHaveBeenCalled());
    // Single-flight ref collapses the second click — exactly one Local chat.
    expect(createChatMutateAsync).toHaveBeenCalledTimes(1);
    expect(createChatMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-42', useWorktree: false })
    );
    expect(store.get(selectedProjectAtom)?.id).toBe('proj-42');
  });

  it('clicking Project statistics sets projectStatsTargetIdAtom and desktopViewAtom', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ProjectGroupActionsMenu project={project as any} chatIds={['chat-1']} />
      </Provider>
    );

    fireEvent.click(screen.getByText(/project statistics/i));

    expect(store.get(projectStatsTargetIdAtom)).toBe('proj-42');
    expect(store.get(desktopViewAtom)).toBe('project-stats');
    expect(store.get(agentsSidebarOpenAtom)).toBe(true);
    expect(store.get(selectedProjectAtom)?.id).toBe('proj-42');
  });

  it('opens the in-window new workspace flow targeted at the project', () => {
    const store = createTestStore();
    store.set(selectedAgentChatIdAtom, 'chat-123');
    store.set(selectedDraftIdAtom, 'draft-123');
    store.set(showNewChatFormAtom, false);
    store.set(newWorkspaceFormKeyAtom, 4);
    store.set(desktopViewAtom, 'project-stats');

    render(
      <Provider store={store}>
        <ProjectGroupActionsMenu project={project as any} chatIds={['chat-1']} />
      </Provider>
    );

    fireEvent.click(screen.getByText(/^new workspace$/i));

    expect(store.get(selectedProjectAtom)?.id).toBe('proj-42');
    expect(store.get(selectedAgentChatIdAtom)).toBeNull();
    expect(store.get(selectedDraftIdAtom)).toBeNull();
    expect(store.get(showNewChatFormAtom)).toBe(true);
    expect(store.get(desktopViewAtom)).toBeNull();
    expect(store.get(newWorkspaceFormKeyAtom)).toBe(5);
  });
});
