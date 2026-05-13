// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileDraft } from './use-file-draft';

describe('useFileDraft', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('evicts the oldest draft when an 11th draft is added', async () => {
    for (let i = 0; i < 11; i += 1) {
      const { result, unmount } = renderHook(() => useFileDraft(`/repo/file-${i}.ts`, `original-${i}`));
      await waitFor(() => {
        act(() => {
          result.current.saveDraft(`edited-${i}`);
        });
        return expect(localStorage.getItem(`file-edit-draft:/repo/file-${i}.ts`)).not.toBeNull();
      });
      unmount();
    }

    const index = JSON.parse(localStorage.getItem('file-edit-drafts-index') || '[]') as Array<{ path: string }>;
    expect(index).toHaveLength(10);
    expect(localStorage.getItem('file-edit-draft:/repo/file-0.ts')).toBeNull();
    expect(localStorage.getItem('file-edit-draft:/repo/file-10.ts')).not.toBeNull();
  });

  it('does not persist content larger than 1 MB', async () => {
    const { result } = renderHook(() => useFileDraft('/repo/large.ts', 'original'));
    await waitFor(() => {
      act(() => {
        result.current.saveDraft('a'.repeat(1024 * 1024 + 1));
      });
      expect(localStorage.getItem('file-edit-draft:/repo/large.ts')).toBeNull();
    });
  });

  it('returns null for malformed localStorage JSON', async () => {
    localStorage.setItem('file-edit-draft:/repo/bad.ts', '{ nope');
    const { result } = renderHook(() => useFileDraft('/repo/bad.ts', 'original'));

    await waitFor(() => {
      expect(result.current.loadDraft()).toBeNull();
    });
  });

  it('clearDraft removes both the draft and its index entry', async () => {
    const { result } = renderHook(() => useFileDraft('/repo/clear.ts', 'original'));

    await waitFor(() => {
      act(() => {
        result.current.saveDraft('edited');
      });
      expect(localStorage.getItem('file-edit-draft:/repo/clear.ts')).not.toBeNull();
    });

    act(() => {
      result.current.clearDraft();
    });

    expect(localStorage.getItem('file-edit-draft:/repo/clear.ts')).toBeNull();
    expect(localStorage.getItem('file-edit-drafts-index')).toBe('[]');
  });
});
