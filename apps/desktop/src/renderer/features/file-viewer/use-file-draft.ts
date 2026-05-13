import { useCallback, useEffect, useMemo, useRef } from 'react';

const DRAFT_PREFIX = 'file-edit-draft:';
const DRAFT_INDEX_KEY = 'file-edit-drafts-index';
const MAX_DRAFTS = 10;
const MAX_DRAFT_BYTES = 1024 * 1024;

export interface FileDraft {
  content: string;
  originalHash: string;
  draftedAt: number;
}

interface DraftIndexEntry {
  path: string;
  draftedAt: number;
}

async function sha1(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getDraftKey(filePath: string): string {
  return `${DRAFT_PREFIX}${filePath}`;
}

function readIndex(): DraftIndexEntry[] {
  try {
    const raw = window.localStorage.getItem(DRAFT_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is DraftIndexEntry =>
        !!entry && typeof entry === 'object' && typeof entry.path === 'string' && typeof entry.draftedAt === 'number'
    );
  } catch {
    return [];
  }
}

function writeIndex(entries: DraftIndexEntry[]): void {
  window.localStorage.setItem(DRAFT_INDEX_KEY, JSON.stringify(entries));
}

function updateIndex(filePath: string, draftedAt: number): void {
  const next = readIndex()
    .filter((entry) => entry.path !== filePath)
    .concat({ path: filePath, draftedAt })
    .sort((a, b) => b.draftedAt - a.draftedAt);

  const evicted = next.slice(MAX_DRAFTS);
  for (const entry of evicted) {
    window.localStorage.removeItem(getDraftKey(entry.path));
  }

  writeIndex(next.slice(0, MAX_DRAFTS));
}

function removeFromIndex(filePath: string): void {
  writeIndex(readIndex().filter((entry) => entry.path !== filePath));
}

export function useFileDraft(filePath: string, originalContent: string) {
  const originalHashRef = useRef<string>('');

  useEffect(() => {
    let cancelled = false;

    void sha1(originalContent).then((hash) => {
      if (!cancelled) {
        originalHashRef.current = hash;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [originalContent]);

  const draftKey = useMemo(() => getDraftKey(filePath), [filePath]);

  const loadDraft = useCallback((): FileDraft | null => {
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof parsed.content !== 'string' ||
        typeof parsed.originalHash !== 'string' ||
        typeof parsed.draftedAt !== 'number'
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }, [draftKey]);

  const saveDraft = useCallback(
    (content: string): void => {
      if (new TextEncoder().encode(content).byteLength > MAX_DRAFT_BYTES) return;
      const originalHash = originalHashRef.current;
      if (!originalHash) return;

      const draftedAt = Date.now();
      const draft: FileDraft = {
        content,
        originalHash,
        draftedAt
      };

      window.localStorage.setItem(draftKey, JSON.stringify(draft));
      updateIndex(filePath, draftedAt);
    },
    [draftKey, filePath]
  );

  const clearDraft = useCallback((): void => {
    window.localStorage.removeItem(draftKey);
    removeFromIndex(filePath);
  }, [draftKey, filePath]);

  return {
    saveDraft,
    clearDraft,
    loadDraft
  };
}

export const fileDraftUtils = {
  sha1
};
