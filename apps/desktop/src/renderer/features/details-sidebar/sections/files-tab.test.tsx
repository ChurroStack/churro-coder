// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockSearchQuery = vi.fn();
const mockGitStatusRefetch = vi.fn(async () => ({ data: undefined }));
const mockClearCacheMutateAsync = vi.fn(async () => ({ success: true }));
const mockInvalidate = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    external: {
      openInApp: { useMutation: () => ({ mutate: vi.fn() }) },
      openInFinder: { useMutation: () => ({ mutate: vi.fn() }) }
    },
    files: {
      renameFile: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }) },
      deleteFile: { useMutation: () => ({ mutate: vi.fn() }) },
      clearCache: { useMutation: () => ({ mutateAsync: mockClearCacheMutateAsync, isPending: false }) },
      search: { useQuery: (...args: unknown[]) => mockSearchQuery(...args) }
    },
    changes: {
      getStatus: { useQuery: () => ({ data: undefined, refetch: mockGitStatusRefetch }) }
    },
    useUtils: () => ({ files: { search: { invalidate: mockInvalidate } } })
  }
}));

vi.mock('@/lib/atoms', () => ({
  preferredEditorAtom: { toString: () => 'preferredEditorAtom', read: () => 'vscode' }
}));

vi.mock('@/components/open-in-button', () => ({
  getAppOption: () => ({ label: 'VS Code', displayLabel: 'VS Code' })
}));

import { FilesTab } from './files-tab';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setupQuery(overrides: Record<string, unknown> = {}) {
  mockSearchQuery.mockReturnValue({
    data: [{ path: 'README.md', type: 'file' }],
    refetch: vi.fn(async () => ({ data: [{ path: 'README.md', type: 'file' }], error: null })),
    isFetching: false,
    ...overrides
  });
}

describe('FilesTab refresh button', () => {
  it('clears the server cache and refetches when clicked', async () => {
    const refetch = vi.fn(async () => ({ data: [], error: null }));
    setupQuery({ refetch });

    render(<FilesTab worktreePath="/tmp/proj" onSelectFile={vi.fn()} showFilterInput />);

    const refreshButton = screen.getByRole('button', { name: /refresh files/i });
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(mockClearCacheMutateAsync).toHaveBeenCalledWith({ projectPath: '/tmp/proj' });
    });
    expect(refetch).toHaveBeenCalledWith({ throwOnError: true });
  });

  it('disables the button and spins the icon while fetching', () => {
    setupQuery({ isFetching: true });

    render(<FilesTab worktreePath="/tmp/proj" onSelectFile={vi.fn()} showFilterInput />);

    const refreshButton = screen.getByRole('button', { name: /refresh files/i }) as HTMLButtonElement;
    expect(refreshButton.disabled).toBe(true);
    const icon = refreshButton.querySelector('svg');
    expect(icon?.getAttribute('class') ?? '').toContain('animate-spin');
  });

  it('does not call clearCache when worktreePath is null', () => {
    setupQuery();
    render(<FilesTab worktreePath={null} onSelectFile={vi.fn()} showFilterInput />);
    expect(screen.queryByRole('button', { name: /refresh files/i })).toBeNull();
    expect(mockClearCacheMutateAsync).not.toHaveBeenCalled();
  });
});
