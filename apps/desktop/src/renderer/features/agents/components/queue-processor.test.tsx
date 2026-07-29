// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AgentQueueItem } from '../lib/queue-utils';
import { appStore } from '../../../lib/jotai-store';
import { subChatBusyAtom, subChatErrorAtom } from '../atoms';
import { QueueProcessor } from './queue-processor';
import { agentChatStore } from '../stores/agent-chat-store';
import { useMessageQueueStore } from '../stores/message-queue-store';
import { useStreamingStatusStore } from '../stores/streaming-status-store';
import { useAgentSubChatStore } from '../stores/sub-chat-store';

const BUILTIN_SUB_CHAT_ID = 'builtin-sub-chat';
const CLI_SUB_CHAT_IDS = ['claude-cli-sub-chat', 'codex-cli-sub-chat'] as const;

function queueItem(id: string, message: string, includeAttachments = false): AgentQueueItem {
  return {
    id,
    message,
    images: includeAttachments
      ? [{ id: 'image-1', url: 'data:image/png;base64,abc', mediaType: 'image/png', filename: 'screen.png', base64Data: 'abc' }]
      : undefined,
    files: includeAttachments
      ? [{ id: 'file-1', url: 'file:///tmp/notes.txt', filename: 'notes.txt', mediaType: 'text/plain', size: 42 }]
      : undefined,
    timestamp: new Date(),
    status: 'pending'
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  agentChatStore.clear();
  useMessageQueueStore.setState({ queues: {}, queueSentTriggers: {} });
  useAgentSubChatStore.setState({
    chatId: 'parent-chat',
    activeSubChatId: null,
    openSubChatIds: [],
    allSubChats: [
      { id: BUILTIN_SUB_CHAT_ID, name: 'Built-in', harness: 'builtin', mode: 'plan' },
      { id: CLI_SUB_CHAT_IDS[0], name: 'Claude CLI', harness: 'claude-cli', mode: 'plan' },
      { id: CLI_SUB_CHAT_IDS[1], name: 'Codex CLI', harness: 'codex-cli', mode: 'plan' }
    ]
  } as any);
  appStore.set(subChatBusyAtom, new Map());
  appStore.set(subChatErrorAtom, new Set());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  agentChatStore.clear();
  useMessageQueueStore.setState({ queues: {}, queueSentTriggers: {} });
  appStore.set(subChatBusyAtom, new Map());
  appStore.set(subChatErrorAtom, new Set());
});

describe('QueueProcessor [built-in-queue-auto-drain]', () => {
  test('dispatches consecutive built-in items while externally idle, preserves attachments, and drains after each finish', async () => {
    const firstSend = deferred<void>();
    const secondSend = deferred<void>();
    const statusesAtDispatch: string[] = [];
    const sendMessage = vi
      .fn()
      .mockImplementationOnce(() => {
        statusesAtDispatch.push(useStreamingStatusStore.getState().getStatus(BUILTIN_SUB_CHAT_ID));
        return firstSend.promise;
      })
      .mockImplementationOnce(() => {
        statusesAtDispatch.push(useStreamingStatusStore.getState().getStatus(BUILTIN_SUB_CHAT_ID));
        return secondSend.promise;
      });
    agentChatStore.set(BUILTIN_SUB_CHAT_ID, { sendMessage } as any, 'parent-chat');

    render(<QueueProcessor />);
    act(() => {
      useMessageQueueStore.getState().addToQueue(BUILTIN_SUB_CHAT_ID, queueItem('first', 'first message', true));
      useMessageQueueStore.getState().addToQueue(BUILTIN_SUB_CHAT_ID, queueItem('second', 'second message'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(statusesAtDispatch).toEqual(['ready']);
    expect(appStore.get(subChatBusyAtom).get(BUILTIN_SUB_CHAT_ID)?.state).toBe('submitted');
    expect(sendMessage).toHaveBeenCalledWith({
      role: 'user',
      parts: [
        {
          type: 'data-image',
          data: {
            url: 'data:image/png;base64,abc',
            mediaType: 'image/png',
            filename: 'screen.png',
            base64Data: 'abc'
          }
        },
        {
          type: 'data-file',
          data: { url: 'file:///tmp/notes.txt', mediaType: 'text/plain', filename: 'notes.txt', size: 42 }
        },
        { type: 'text', text: 'first message' }
      ]
    });

    await act(async () => {
      firstSend.resolve();
      useStreamingStatusStore.getState().setStatus(BUILTIN_SUB_CHAT_ID, 'ready');
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(statusesAtDispatch).toEqual(['ready', 'ready']);
    expect(appStore.get(subChatBusyAtom).get(BUILTIN_SUB_CHAT_ID)?.state).toBe('submitted');

    await act(async () => {
      secondSend.resolve();
      useStreamingStatusStore.getState().setStatus(BUILTIN_SUB_CHAT_ID, 'ready');
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(useMessageQueueStore.getState().getQueue(BUILTIN_SUB_CHAT_ID)).toEqual([]);
    expect(useStreamingStatusStore.getState().getStatus(BUILTIN_SUB_CHAT_ID)).toBe('ready');
  });

  test('leaves claude-cli and codex-cli queue entries untouched because CLI dispatch stays on terminal.write', async () => {
    const sendMessage = vi.fn();
    render(<QueueProcessor />);
    act(() => {
      for (const subChatId of CLI_SUB_CHAT_IDS) {
        useMessageQueueStore.getState().addToQueue(subChatId, queueItem(`${subChatId}-item`, 'CLI prompt'));
      }
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(sendMessage).not.toHaveBeenCalled();
    for (const subChatId of CLI_SUB_CHAT_IDS) {
      expect(useMessageQueueStore.getState().getQueue(subChatId)).toHaveLength(1);
      expect(agentChatStore.get(subChatId)).toBeUndefined();
    }
  });
});
