// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'jotai';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { createTestStore } from '../../../../../test-utils/create-test-store';
import { agentsSettingsDialogActiveTabAtom, desktopViewAtom } from '../../../lib/atoms';
import { PreviewSetupHoverCard } from './preview-setup-hover-card';

// next-themes has no provider in the test tree; the component only reads
// resolvedTheme to pick an image src.
vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light' })
}));

// Radix HoverCard is portal- and hover-gated (no content in the DOM until an
// async open). Render the content inline so the action button is queryable.
vi.mock('../../../components/ui/hover-card', () => ({
  HoverCard: ({ children }: PropsWithChildren) => <div>{children}</div>,
  HoverCardTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
  HoverCardContent: ({ children }: PropsWithChildren) => <div>{children}</div>
}));

afterEach(cleanup);

describe('PreviewSetupHoverCard', () => {
  it('"Set up repository" opens settings on the Projects tab', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <PreviewSetupHoverCard>
          <button type="button">preview</button>
        </PreviewSetupHoverCard>
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: /set up repository/i }));

    // agentsSettingsDialogOpenAtom is derived — its setter routes through
    // desktopView='settings'. Assert both the destination tab and the open.
    expect(store.get(agentsSettingsDialogActiveTabAtom)).toBe('projects');
    expect(store.get(desktopViewAtom)).toBe('settings');
  });
});
