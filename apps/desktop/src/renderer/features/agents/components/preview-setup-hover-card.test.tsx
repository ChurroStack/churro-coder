// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'jotai';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { createTestStore } from '../../../../../test-utils/create-test-store';
import { selectedProjectAtom, selectedAgentChatIdAtom } from '../../../lib/atoms';
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

const createChatMutateAsync = vi.fn().mockResolvedValue({ id: 'local-1' });
const listFetch = vi.fn().mockResolvedValue([]);

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ chats: { list: { fetch: listFetch, invalidate: vi.fn() } } }),
    chats: { create: { useMutation: () => ({ mutateAsync: createChatMutateAsync, isPending: false }) } }
  }
}));

afterEach(cleanup);

describe('PreviewSetupHoverCard', () => {
  it('"Set up repository" opens the selected project\'s local workspace', async () => {
    const store = createTestStore();
    store.set(selectedProjectAtom, { id: 'proj-9', name: 'Proj', path: '/proj' });
    render(
      <Provider store={store}>
        <PreviewSetupHoverCard>
          <button type="button">preview</button>
        </PreviewSetupHoverCard>
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: /set up repository/i }));

    // Worktree/repo setup now lives in the workspace Project Settings panel,
    // reached by opening the project's Local workspace.
    await waitFor(() =>
      expect(createChatMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'proj-9', useWorktree: false })
      )
    );
    expect(store.get(selectedAgentChatIdAtom)).toBe('local-1');
  });
});
