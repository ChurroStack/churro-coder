// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { Provider } from 'jotai';
import { InfoSection } from './info-section';

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
  TooltipTrigger: ({ children }: PropsWithChildren<{ asChild?: boolean }>) => <>{children}</>,
  TooltipContent: ({ children }: PropsWithChildren<{ side?: string; className?: string }>) => <div>{children}</div>
}));

vi.mock('./rename-pr-title-dialog', () => ({
  RenamePrTitleDialog: () => null
}));

vi.mock('@/lib/hotkeys', () => ({
  useResolvedHotkeyDisplay: () => null
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    external: {
      openInFinder: {
        useMutation: () => ({ mutate: vi.fn() })
      },
      openInApp: {
        useMutation: () => ({ mutate: vi.fn() })
      }
    },
    changes: {
      getBranches: {
        useQuery: () => ({ data: { current: 'main' }, isLoading: false })
      }
    },
    chats: {
      getPrStatus: {
        useQuery: () => ({ data: null })
      }
    }
  }
}));

function setPlatform(platform: 'darwin' | 'win32') {
  (window as any).desktopApi = {
    platform,
    openExternal: vi.fn()
  };
}

function renderInfoSection() {
  render(
    <Provider>
      <InfoSection chatId="chat-1" worktreePath="/repo/worktree-a" />
    </Provider>
  );
}

describe('InfoSection', () => {
  beforeEach(() => {
    setPlatform('darwin');
  });

  it('shows the Finder tooltip on macOS', () => {
    renderInfoSection();

    expect(screen.getByText('Open in Finder')).not.toBeNull();
    expect(screen.queryByText('Open in File Explorer')).toBeNull();
  });

  it('shows the File Explorer tooltip on Windows', () => {
    setPlatform('win32');
    renderInfoSection();

    expect(screen.getByText('Open in File Explorer')).not.toBeNull();
    expect(screen.queryByText('Open in Finder')).toBeNull();
  });
});
