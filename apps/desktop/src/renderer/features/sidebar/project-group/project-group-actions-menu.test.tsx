// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'jotai';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { createTestStore } from '../../../../../test-utils/create-test-store';
import {
  agentsSidebarOpenAtom,
  desktopViewAtom,
  projectStatsTargetIdAtom,
  selectedProjectAtom
} from '../../../lib/atoms';
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

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      chats: { list: { invalidate: vi.fn() } },
      projects: { list: { invalidate: vi.fn() } }
    }),
    external: {
      openInApp: { useMutation: () => ({ mutate: vi.fn() }) },
      openInFinder: { useMutation: () => ({ mutate: vi.fn() }) }
    },
    chats: {
      archiveBatch: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) }
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

describe('ProjectGroupActionsMenu – Project statistics item', () => {
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
});
