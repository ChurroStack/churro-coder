// @vitest-environment jsdom

/**
 * Regression: pasted-text files must survive a save→restore round-trip through
 * the sub-chat draft store (localStorage), mirroring the new-chat-form behaviour.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { saveSubChatDraftWithAttachments, getSubChatDraftFull } from '../lib/drafts';
import type { PastedTextFile } from '../hooks/use-pasted-text-files';

const CHAT_ID = 'chat-test-1';
const SUB_CHAT_ID = 'sub-test-1';

const fakePastedText: PastedTextFile = {
  id: 'pasted_1',
  filePath: '/fake/agent-sessions/sub-test-1/pasted/pasted_1.txt',
  filename: 'pasted_1.txt',
  size: 42,
  preview: 'Hello world',
  createdAt: new Date('2026-05-09T12:00:00.000Z')
};

beforeEach(() => {
  localStorage.clear();
});

describe('sub-chat draft — pasted text round-trip', () => {
  it('saveSubChatDraftWithAttachments forwards pastedTexts and getSubChatDraftFull restores them', async () => {
    await saveSubChatDraftWithAttachments(CHAT_ID, SUB_CHAT_ID, 'some draft text', {
      pastedTexts: [fakePastedText]
    });

    const restored = getSubChatDraftFull(CHAT_ID, SUB_CHAT_ID);

    expect(restored).not.toBeNull();
    expect(restored!.pastedTexts).toHaveLength(1);
    expect(restored!.pastedTexts[0]).toMatchObject({
      id: 'pasted_1',
      filename: 'pasted_1.txt',
      size: 42,
      preview: 'Hello world'
    });
  });

  it('hasContent is true when only pastedTexts are present (no text)', async () => {
    await saveSubChatDraftWithAttachments(CHAT_ID, SUB_CHAT_ID, '', {
      pastedTexts: [fakePastedText]
    });

    const restored = getSubChatDraftFull(CHAT_ID, SUB_CHAT_ID);

    expect(restored).not.toBeNull();
    expect(restored!.pastedTexts).toHaveLength(1);
  });

  it('clears draft when no content including no pastedTexts', async () => {
    // First save something so the key exists
    await saveSubChatDraftWithAttachments(CHAT_ID, SUB_CHAT_ID, 'text', {});

    // Now save empty
    await saveSubChatDraftWithAttachments(CHAT_ID, SUB_CHAT_ID, '', {
      pastedTexts: []
    });

    const restored = getSubChatDraftFull(CHAT_ID, SUB_CHAT_ID);
    expect(restored).toBeNull();
  });
});
