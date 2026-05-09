import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveNewChatDraft,
  saveNewChatDraftWithAttachments,
  markDraftVisible,
  loadGlobalDrafts,
  generateDraftId,
  DRAFTS_STORAGE_KEY
} from './drafts';

// Minimal localStorage stub (vitest runs in Node, not a browser)
const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    }
  },
  writable: true
});
Object.defineProperty(globalThis, 'window', {
  value: {
    dispatchEvent: () => {},
    localStorage: globalThis.localStorage
  },
  writable: true
});

beforeEach(() => {
  delete store[DRAFTS_STORAGE_KEY];
});

describe('isVisible preservation across saves', () => {
  it('saveNewChatDraft preserves isVisible after markDraftVisible', () => {
    const id = generateDraftId();
    saveNewChatDraft(id, 'hello');
    markDraftVisible(id);

    // Simulate a subsequent auto-save (e.g. user keeps typing after navigating away)
    saveNewChatDraft(id, 'hello world');

    const drafts = loadGlobalDrafts();
    expect((drafts[id] as { isVisible?: boolean }).isVisible).toBe(true);
  });

  it('saveNewChatDraftWithAttachments preserves isVisible after markDraftVisible', async () => {
    const id = generateDraftId();
    await saveNewChatDraftWithAttachments(id, 'hello');
    markDraftVisible(id);

    await saveNewChatDraftWithAttachments(id, 'hello world');

    const drafts = loadGlobalDrafts();
    expect((drafts[id] as { isVisible?: boolean }).isVisible).toBe(true);
  });

  it('saveNewChatDraftWithAttachments storage-limit fallback preserves isVisible', async () => {
    const id = generateDraftId();
    await saveNewChatDraftWithAttachments(id, 'hello');
    markDraftVisible(id);

    // Flood storage so the size check triggers the fallback path.
    // We do this by pre-filling the store with a large blob under a dummy key.
    const padding = 'x'.repeat(5 * 1024 * 1024); // 5 MB of chars
    store['__padding__'] = padding;

    await saveNewChatDraftWithAttachments(id, 'hello world', undefined, {
      images: [
        {
          id: 'img1',
          filename: 'a.png',
          url: 'blob:fake',
          base64Data: 'aGVsbG8=', // valid base64
          mediaType: 'image/png',
          isLoading: false
        }
      ]
    });

    delete store['__padding__'];
    const drafts = loadGlobalDrafts();
    expect((drafts[id] as { isVisible?: boolean }).isVisible).toBe(true);
  });
});
