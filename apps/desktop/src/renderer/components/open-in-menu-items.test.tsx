// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'jotai';
import { TooltipProvider } from './ui/tooltip';
import { DropdownMenu, DropdownMenuContent } from './ui/dropdown-menu';
import { OpenInMenuItems } from './open-in-menu-items';

const openInAppMutate = vi.fn();

vi.mock('../lib/trpc', () => ({
  trpc: {
    external: {
      openInApp: {
        useMutation: () => ({ mutate: openInAppMutate })
      }
    }
  }
}));

function setPlatform(platform: 'darwin' | 'win32') {
  (window as any).desktopApi = { platform };
}

describe('OpenInMenuItems', () => {
  beforeEach(() => {
    openInAppMutate.mockReset();
    setPlatform('darwin');
  });

  it('renders app items and invokes the open mutation when an item is chosen', () => {
    render(
      <Provider>
        <TooltipProvider>
          <DropdownMenu open>
            <DropdownMenuContent>
              <OpenInMenuItems path="/repo" />
            </DropdownMenuContent>
          </DropdownMenu>
        </TooltipProvider>
      </Provider>
    );

    fireEvent.click(screen.getByText('Cursor'));

    expect(openInAppMutate).toHaveBeenCalledWith({ path: '/repo', app: 'cursor' });
  });

  it('shows Finder on macOS', () => {
    setPlatform('darwin');

    render(
      <Provider>
        <TooltipProvider>
          <DropdownMenu open>
            <DropdownMenuContent>
              <OpenInMenuItems path="/repo" />
            </DropdownMenuContent>
          </DropdownMenu>
        </TooltipProvider>
      </Provider>
    );

    expect(screen.getByText('Finder')).not.toBeNull();
    expect(screen.queryByText('File Explorer')).toBeNull();
  });

  it('shows File Explorer on Windows', () => {
    setPlatform('win32');

    render(
      <Provider>
        <TooltipProvider>
          <DropdownMenu open>
            <DropdownMenuContent>
              <OpenInMenuItems path="/repo" />
            </DropdownMenuContent>
          </DropdownMenu>
        </TooltipProvider>
      </Provider>
    );

    expect(screen.getByText('File Explorer')).not.toBeNull();
    expect(screen.queryByText('Finder')).toBeNull();
  });
});
