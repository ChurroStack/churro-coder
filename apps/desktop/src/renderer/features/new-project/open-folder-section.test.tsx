// @vitest-environment jsdom
/**
 * Regression: opening a folder from the welcome screen showed a white screen because
 * the success path set `selectedProject` without writing the `projects.list` cache, so
 * App.tsx's `validatedProject` check failed and it fell back to the blank EmptyStateShell.
 * These tests pin the success path: cache write (setData + invalidate) + selection, and
 * that cancelling the picker (null result) leaves the dialog open instead of stranding it.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { cleanup, screen, fireEvent, act } from '@testing-library/react';
import { createTestStore, renderWithProviders } from '../../../../test-utils';
import { OpenFolderSection } from './open-folder-section';
import { newProjectDialogOpenAtom } from './atoms';
import { selectedProjectAtom } from '@/lib/atoms';

afterEach(cleanup);

// ── tRPC mock ───────────────────────────────────────────────────────────────
const mockSetData = vi.fn();
const mockInvalidate = vi.fn();
const mockUtils = { projects: { list: { setData: mockSetData, invalidate: mockInvalidate } } };

let capturedOnSuccess: ((project: unknown) => void) | undefined;
const mockMutate = vi.fn();
const mockUseMutation = vi.fn((opts: { onSuccess?: (project: unknown) => void }) => {
  capturedOnSuccess = opts.onSuccess;
  return { mutate: mockMutate, isPending: false };
});

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => mockUtils),
    projects: {
      openFolder: { useMutation: (opts: { onSuccess?: (project: unknown) => void }) => mockUseMutation(opts) }
    }
  }
}));

const PROJECT = {
  id: 'proj-1',
  name: 'my-app',
  path: '/Users/me/code/my-app',
  gitRemoteUrl: null,
  gitProvider: null,
  gitOwner: null,
  gitRepo: null,
  updatedAt: 123
};

beforeEach(() => {
  vi.clearAllMocks();
  capturedOnSuccess = undefined;
});

describe('OpenFolderSection', () => {
  it('clicking Select folder triggers the openFolder mutation', () => {
    const store = createTestStore();
    renderWithProviders(<OpenFolderSection />, { store });
    fireEvent.click(screen.getByRole('button', { name: /select folder/i }));
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it('on success: writes the projects.list cache, selects the project, and closes the dialog', () => {
    const store = createTestStore();
    store.set(newProjectDialogOpenAtom, true);
    renderWithProviders(<OpenFolderSection />, { store });

    act(() => {
      capturedOnSuccess?.(PROJECT);
    });

    // Cache write makes App.tsx's validatedProject pass synchronously (no white screen)
    expect(mockSetData).toHaveBeenCalledTimes(1);
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
    // Optimistic insert into an empty/non-array cache yields a single-element list
    const updater = mockSetData.mock.calls[0][1] as (old: unknown) => unknown;
    expect(updater(undefined)).toEqual([PROJECT]);
    expect(updater([])).toEqual([PROJECT]);
    // Selection + dialog close
    expect(store.get(selectedProjectAtom)?.id).toBe('proj-1');
    expect(store.get(newProjectDialogOpenAtom)).toBe(false);
  });

  it('on cancel (null result): leaves the dialog open and selects nothing', () => {
    const store = createTestStore();
    store.set(newProjectDialogOpenAtom, true);
    renderWithProviders(<OpenFolderSection />, { store });

    act(() => {
      capturedOnSuccess?.(null);
    });

    expect(mockSetData).not.toHaveBeenCalled();
    expect(store.get(selectedProjectAtom)).toBeNull();
    expect(store.get(newProjectDialogOpenAtom)).toBe(true);
  });
});
