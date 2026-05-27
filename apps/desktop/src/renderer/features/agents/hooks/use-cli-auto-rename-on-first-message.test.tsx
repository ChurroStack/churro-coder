// @vitest-environment jsdom
/**
 * Tests for useCliAutoRenameOnFirstMessage — the renderer hook that watches
 * the JSONL ingester's `cliSession.onMessages` stream and fires the rename
 * dispatcher exactly once per sub-chat when the first user message lands.
 *
 * Coverage:
 *   - Fires on first user message when name is 'New Chat'.
 *   - Fires when name is 'New chat' (alternate casing) and when name is missing.
 *   - Does NOT fire when the persisted name is already custom.
 *   - Does NOT fire twice for the same sub-chat (module-level dedup Set).
 *   - Does NOT fire when no user message is present in the latest fetch.
 *   - Does NOT subscribe when parentChatId is missing.
 */

const mockAutoRenameDispatcher = vi.hoisted(() => vi.fn());
const mockGetLatestFetch = vi.hoisted(() => vi.fn());

const mockSubscriptionCallback = vi.hoisted(() => ({
  enabled: false,
  onData: null as null | ((evt: { subChatId: string; newMessageCount: number; sideEffectsApplied: number }) => void)
}));

const mockStore = vi.hoisted(() => ({
  chatId: 'chat-1' as string | null,
  allSubChats: [{ id: 'sc-1', harness: 'claude-cli', name: undefined as string | undefined }] as Array<{
    id: string;
    harness: string;
    name?: string;
  }>
}));

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      messages: {
        getLatest: {
          fetch: mockGetLatestFetch
        }
      }
    }),
    cliSession: {
      onMessages: {
        useSubscription: vi.fn(
          (
            _input: { subChatId: string },
            opts: {
              enabled?: boolean;
              onData?: (evt: { subChatId: string; newMessageCount: number; sideEffectsApplied: number }) => void;
            }
          ) => {
            mockSubscriptionCallback.enabled = opts.enabled ?? true;
            mockSubscriptionCallback.onData = opts.onData ?? null;
          }
        )
      }
    }
  }
}));

vi.mock('../stores/sub-chat-store', () => {
  const useAgentSubChatStore = vi.fn((selector: (s: unknown) => unknown) => selector(mockStore)) as unknown as {
    (selector: (s: unknown) => unknown): unknown;
    getState: () => typeof mockStore;
  };
  useAgentSubChatStore.getState = () => mockStore;
  return { useAgentSubChatStore };
});

vi.mock('./use-auto-rename-dispatcher', () => ({
  useAgentAutoRenameDispatcher: vi.fn(() => mockAutoRenameDispatcher)
}));

vi.mock('../../../../shared/cli-text-envelopes', () => ({
  stripClaudeCliEnvelopes: (s: string) => s
}));

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import React from 'react';
import { useCliAutoRenameOnFirstMessage } from './use-cli-auto-rename-on-first-message';
import { _resetCliAutoRenameTriggered } from '../lib/auto-rename-state';

function Harness({ subChatId, parentChatId }: { subChatId: string; parentChatId: string | null }): React.ReactElement {
  useCliAutoRenameOnFirstMessage(subChatId, parentChatId);
  return <div />;
}

const FIRST_USER_ROW = {
  id: 'msg-1',
  role: 'user' as const,
  parts: JSON.stringify([{ type: 'text', text: 'Build me a feature' }])
};

afterEach(() => {
  cleanup();
  mockAutoRenameDispatcher.mockClear();
  mockGetLatestFetch.mockReset();
  mockSubscriptionCallback.enabled = false;
  mockSubscriptionCallback.onData = null;
  mockStore.chatId = 'chat-1';
  mockStore.allSubChats = [{ id: 'sc-1', harness: 'claude-cli', name: undefined }];
  _resetCliAutoRenameTriggered();
});

describe('useCliAutoRenameOnFirstMessage [hooks/use-cli-auto-rename-on-first-message]', () => {
  it('fires on first user message when persisted name is missing', async () => {
    mockGetLatestFetch.mockResolvedValue([FIRST_USER_ROW]);
    render(<Harness subChatId="sc-1" parentChatId="chat-1" />);

    await act(async () => {
      await mockSubscriptionCallback.onData?.({ subChatId: 'sc-1', newMessageCount: 1, sideEffectsApplied: 0 });
    });

    expect(mockAutoRenameDispatcher).toHaveBeenCalledTimes(1);
    expect(mockAutoRenameDispatcher).toHaveBeenCalledWith('Build me a feature', 'sc-1');
  });

  it("fires when persisted name is the 'New Chat' placeholder (hydration casing)", async () => {
    mockStore.allSubChats = [{ id: 'sc-1', harness: 'claude-cli', name: 'New Chat' }];
    mockGetLatestFetch.mockResolvedValue([FIRST_USER_ROW]);
    render(<Harness subChatId="sc-1" parentChatId="chat-1" />);

    await act(async () => {
      await mockSubscriptionCallback.onData?.({ subChatId: 'sc-1', newMessageCount: 1, sideEffectsApplied: 0 });
    });

    expect(mockAutoRenameDispatcher).toHaveBeenCalledTimes(1);
  });

  it("fires when persisted name is the 'New chat' placeholder (form-save casing)", async () => {
    mockStore.allSubChats = [{ id: 'sc-1', harness: 'claude-cli', name: 'New chat' }];
    mockGetLatestFetch.mockResolvedValue([FIRST_USER_ROW]);
    render(<Harness subChatId="sc-1" parentChatId="chat-1" />);

    await act(async () => {
      await mockSubscriptionCallback.onData?.({ subChatId: 'sc-1', newMessageCount: 1, sideEffectsApplied: 0 });
    });

    expect(mockAutoRenameDispatcher).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire when the persisted name is a real title', async () => {
    mockStore.allSubChats = [{ id: 'sc-1', harness: 'claude-cli', name: 'Refactor billing flow' }];
    mockGetLatestFetch.mockResolvedValue([FIRST_USER_ROW]);
    render(<Harness subChatId="sc-1" parentChatId="chat-1" />);

    await act(async () => {
      await mockSubscriptionCallback.onData?.({ subChatId: 'sc-1', newMessageCount: 1, sideEffectsApplied: 0 });
    });

    expect(mockAutoRenameDispatcher).not.toHaveBeenCalled();
    expect(mockGetLatestFetch).not.toHaveBeenCalled();
  });

  it('does NOT fire a second time for the same sub-chat (module-level gate)', async () => {
    mockGetLatestFetch.mockResolvedValue([FIRST_USER_ROW]);
    render(<Harness subChatId="sc-1" parentChatId="chat-1" />);

    await act(async () => {
      await mockSubscriptionCallback.onData?.({ subChatId: 'sc-1', newMessageCount: 1, sideEffectsApplied: 0 });
    });
    await act(async () => {
      await mockSubscriptionCallback.onData?.({ subChatId: 'sc-1', newMessageCount: 2, sideEffectsApplied: 0 });
    });

    expect(mockAutoRenameDispatcher).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire when the latest fetch contains no user message', async () => {
    mockGetLatestFetch.mockResolvedValue([
      {
        id: 'msg-1',
        role: 'assistant' as const,
        parts: JSON.stringify([{ type: 'text', text: 'starting up' }])
      }
    ]);
    render(<Harness subChatId="sc-1" parentChatId="chat-1" />);

    await act(async () => {
      await mockSubscriptionCallback.onData?.({ subChatId: 'sc-1', newMessageCount: 1, sideEffectsApplied: 0 });
    });

    expect(mockAutoRenameDispatcher).not.toHaveBeenCalled();
  });

  it('does NOT enable the subscription when parentChatId is missing', () => {
    render(<Harness subChatId="sc-1" parentChatId={null} />);
    expect(mockSubscriptionCallback.enabled).toBe(false);
  });
});
