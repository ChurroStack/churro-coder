// @vitest-environment jsdom
/**
 * Tests for IsolatedMessagesSection — specifically the `showContinueButton`
 * gate that hides the Continue / Restart pair in the CLI conversation pane
 * (which is read-only and doesn't drive the LLM).
 */

const mockUserMsgIds = vi.hoisted(() => ({ value: ['user-1'] as string[] }));
const mockIsStreaming = vi.hoisted(() => ({ value: false }));
const mockLastMessage = vi.hoisted(() => ({
  value: { id: 'user-1', role: 'user', metadata: undefined } as {
    id: string;
    role: 'user' | 'assistant';
    metadata?: { resultSubtype?: string };
  } | null
}));

vi.mock('jotai', async () => {
  const actual = await vi.importActual<typeof import('jotai')>('jotai');
  return {
    ...actual,
    useAtomValue: vi.fn((atom: unknown) => {
      if (atom && typeof atom === 'object' && '_tag' in atom) {
        const tag = (atom as { _tag: string })._tag;
        if (tag === 'user-msg-ids') return mockUserMsgIds.value;
        if (tag === 'message-ids') return mockUserMsgIds.value;
        if (tag === 'last-message') return mockLastMessage.value;
      }
      return undefined;
    }),
    useSetAtom: vi.fn(() => vi.fn())
  };
});

vi.mock('../stores/message-store', () => ({
  userMessageIdsPerChatAtom: vi.fn(() => ({ _tag: 'user-msg-ids' })),
  messageIdsPerChatAtom: vi.fn(() => ({ _tag: 'message-ids' })),
  messageAtomFamily: vi.fn(() => ({ _tag: 'last-message' })),
  getPerChatMessageKey: (sub: string, id: string) => `${sub}:${id}`
}));

vi.mock('../stores/streaming-status-store', () => ({
  useStreamingStatusStore: Object.assign(
    vi.fn((selector: (s: { isStreaming: (id: string) => boolean }) => unknown) =>
      selector({ isStreaming: () => mockIsStreaming.value })
    ),
    {
      getState: () => ({
        isStreaming: () => mockIsStreaming.value,
        clearStatus: () => undefined,
        getStatus: () => 'ready'
      })
    }
  )
}));

vi.mock('../stores/agent-chat-store', () => ({
  agentChatStore: { delete: () => undefined }
}));

vi.mock('../atoms', () => ({
  pendingContinueMessageAtomFamily: vi.fn(() => ({ _tag: 'pending-continue' }))
}));

vi.mock('./isolated-message-group', () => ({
  IsolatedMessageGroup: ({ userMsgId }: { userMsgId: string }) => <div data-testid={`group-${userMsgId}`}>group</div>
}));

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { IsolatedMessagesSection } from './isolated-messages-section';

const noopComponents = {
  UserBubbleComponent: () => null,
  ToolCallComponent: () => null,
  MessageGroupWrapper: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  toolRegistry: {} as Record<string, { icon: unknown; title: (args: unknown) => string }>
};

afterEach(() => {
  cleanup();
  mockUserMsgIds.value = ['user-1'];
  mockIsStreaming.value = false;
  mockLastMessage.value = { id: 'user-1', role: 'user', metadata: undefined };
});

describe('IsolatedMessagesSection — Continue button gating [isolated-messages-section/continue-gate]', () => {
  it('renders Continue button by default (builtin chat consumer)', () => {
    const { queryByRole } = render(
      <IsolatedMessagesSection
        subChatId="sc-1"
        chatId="chat-1"
        isMobile={false}
        sandboxSetupStatus="ready"
        stickyTopClass="top-0"
        {...noopComponents}
      />
    );
    expect(queryByRole('button', { name: /Continue/ })).toBeTruthy();
  });

  it('hides Continue + Restart when showContinueButton={false} (CLI conversation pane)', () => {
    const { queryByRole, queryByTitle } = render(
      <IsolatedMessagesSection
        subChatId="sc-1"
        chatId="chat-1"
        isMobile={false}
        sandboxSetupStatus="ready"
        stickyTopClass="top-0"
        showContinueButton={false}
        {...noopComponents}
      />
    );
    expect(queryByRole('button', { name: /Continue/ })).toBeNull();
    expect(queryByTitle(/Hard restart/i)).toBeNull();
  });
});
