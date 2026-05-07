// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'jotai';
import { describe, expect, it, vi } from 'vitest';
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

describe('OpenInMenuItems', () => {
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
});
