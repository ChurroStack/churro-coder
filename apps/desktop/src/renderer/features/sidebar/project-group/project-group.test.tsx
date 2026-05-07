// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'jotai';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { createTestStore } from '../../../../../test-utils/create-test-store';
import {
  agentsSettingsDialogActiveTabAtom,
  agentsSidebarOpenAtom,
  selectedProjectAtom,
  desktopViewAtom
} from '../../../lib/atoms';
import { ProjectGroup } from './project-group';

const archiveBatchMutate = vi.fn();
const deleteProjectMutate = vi.fn();
const openInAppMutate = vi.fn();
const openInFinderMutate = vi.fn();
const invalidate = vi.fn();

vi.mock('../../../components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
    className
  }: PropsWithChildren<{ onClick?: () => void; disabled?: boolean; className?: string }>) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-disabled={disabled ? '' : undefined}
      className={className}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>
}));

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      chats: { list: { invalidate } },
      projects: { list: { invalidate } }
    }),
    external: {
      openInApp: { useMutation: () => ({ mutate: openInAppMutate }) },
      openInFinder: { useMutation: () => ({ mutate: openInFinderMutate }) }
    },
    chats: {
      archiveBatch: { useMutation: () => ({ mutate: archiveBatchMutate, isPending: false }) }
    },
    projects: {
      delete: { useMutation: () => ({ mutate: deleteProjectMutate, isPending: false }) }
    }
  }
}));

describe('ProjectGroup', () => {
  it('toggles open state, shows menu actions, and deep-links to project settings', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <TooltipProvider>
          <ProjectGroup
            forceExpand={false}
            isSearching={false}
            group={{
              id: 'p1',
              kind: 'local',
              project: { id: 'p1', name: 'Alpha', path: '/alpha' },
              displayName: 'Alpha',
              chats: [{ id: 'c1', name: 'Chat 1', updatedAt: new Date(), projectId: 'p1', isRemote: false }],
              lastActivityAt: Date.now(),
              status: 'pendingQuestion'
            }}>
            <div>Chat body</div>
          </ProjectGroup>
        </TooltipProvider>
      </Provider>
    );

    expect(screen.getByTestId('project-status-pendingQuestion')).toBeTruthy();
    expect(screen.getByText('Chat body')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /alpha/i }));
    expect(screen.queryByText('Chat body')).toBeNull();

    expect(screen.getByText('Archive workspaces')).toBeTruthy();
    expect(screen.getByRole('button', { name: /remove repository/i }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByText('Settings'));
    expect(store.get(selectedProjectAtom)?.id).toBe('p1');
    expect(store.get(agentsSettingsDialogActiveTabAtom)).toBe('projects');
    expect(store.get(desktopViewAtom)).toBe('settings');
    expect(store.get(agentsSidebarOpenAtom)).toBe(true);
  });

  it('shows the empty state and no actions menu for unknown groups', () => {
    render(
      <Provider>
        <TooltipProvider>
          <ProjectGroup
            forceExpand={false}
            isSearching={false}
            group={{
              id: '__unknown__',
              kind: 'unknown',
              project: null,
              displayName: 'Other',
              chats: [],
              lastActivityAt: 0,
              status: 'none'
            }}>
            <div />
          </ProjectGroup>
        </TooltipProvider>
      </Provider>
    );

    expect(screen.getByText('No workspaces')).toBeTruthy();
    expect(screen.queryByLabelText('Project actions')).toBeNull();
  });
});
