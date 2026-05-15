// @vitest-environment jsdom
import { act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('../stores/agent-chat-store', () => ({
  agentChatStore: {
    delete: vi.fn(),
    get: vi.fn(),
    has: vi.fn(),
    set: vi.fn(),
    setStreamId: vi.fn(),
    getStreamId: vi.fn(),
    evict: vi.fn(),
    nextChatInstanceId: vi.fn(() => 'test-id'),
    getParentChatId: vi.fn(),
    setManuallyAborted: vi.fn(),
    wasManuallyAborted: vi.fn(),
    clearManuallyAborted: vi.fn(),
    clear: vi.fn(),
    keys: vi.fn(() => [])
  }
}));

import { toast } from 'sonner';
import { createTestStore, renderWithProviders } from '../../../../../test-utils';
import { agentChatStore } from '../stores/agent-chat-store';
import { getPerChatMessageKey, messageAtomFamily, messageIdsPerChatAtom, type Message } from '../stores/message-store';
import { useStreamingStatusStore } from '../stores/streaming-status-store';
import { pendingContinueMessageAtom } from '../atoms';
import { ContinueButton, hardRestartSubChat } from './continue-button';

const SUB = 'test-sub';
const STUCK_MS = 10_000;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  useStreamingStatusStore.setState({ statuses: {} });
});

function seedUserMessage() {
  const store = createTestStore();
  store.set(messageIdsPerChatAtom(SUB), ['msg-1']);
  store.set(messageAtomFamily(getPerChatMessageKey(SUB, 'msg-1')), {
    id: 'msg-1',
    role: 'user'
  } as Message);
  return store;
}

describe('hardRestartSubChat', () => {
  it('deletes transport, clears status, and toasts when idle', () => {
    useStreamingStatusStore.getState().setStatus(SUB, 'ready');

    const result = hardRestartSubChat(SUB);

    expect(result).toBe(true);
    expect(agentChatStore.delete).toHaveBeenCalledWith(SUB);
    expect(useStreamingStatusStore.getState().getStatus(SUB)).toBe('ready');
    expect(toast.info).toHaveBeenCalledWith(
      'Agent restarted',
      expect.objectContaining({ description: expect.stringContaining('reset') })
    );
  });

  it('refuses and toasts when streaming', () => {
    useStreamingStatusStore.getState().setStatus(SUB, 'streaming');

    const result = hardRestartSubChat(SUB);

    expect(result).toBe(false);
    expect(agentChatStore.delete).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith('Already streaming', expect.objectContaining({}));
  });

  it('refuses when in submitted state (in-flight request)', () => {
    useStreamingStatusStore.getState().setStatus(SUB, 'submitted');

    const result = hardRestartSubChat(SUB);

    expect(result).toBe(false);
    expect(agentChatStore.delete).not.toHaveBeenCalled();
  });
});

describe('ContinueButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('renders Continue and Restart buttons when last message is user', () => {
    const store = seedUserMessage();
    const { container } = renderWithProviders(<ContinueButton subChatId={SUB} />, { store });
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(2);
  });

  it('returns null while streaming', () => {
    useStreamingStatusStore.getState().setStatus(SUB, 'streaming');
    const store = seedUserMessage();
    const { container } = renderWithProviders(<ContinueButton subChatId={SUB} />, { store });
    expect(container.querySelector('button')).toBeNull();
  });

  it('sets the pending atom when Continue is clicked', () => {
    const store = seedUserMessage();
    const { container } = renderWithProviders(<ContinueButton subChatId={SUB} />, { store });

    fireEvent.click(container.querySelectorAll('button')[0]);

    expect(store.get(pendingContinueMessageAtom)).toEqual({ subChatId: SUB });
  });

  it('fires the stuck warning after 10s when status remains ready', () => {
    const store = seedUserMessage();
    const { container } = renderWithProviders(<ContinueButton subChatId={SUB} />, { store });

    fireEvent.click(container.querySelectorAll('button')[0]);
    expect(toast.warning).not.toHaveBeenCalled();

    vi.advanceTimersByTime(STUCK_MS);

    expect(toast.warning).toHaveBeenCalledWith(
      "Claude isn't responding",
      expect.objectContaining({
        id: `stuck-${SUB}`,
        duration: Infinity,
        action: expect.objectContaining({ label: 'Restart' })
      })
    );
  });

  it('suppresses the stuck warning when status moved to submitted before timeout', () => {
    const store = seedUserMessage();
    const { container } = renderWithProviders(<ContinueButton subChatId={SUB} />, { store });

    fireEvent.click(container.querySelectorAll('button')[0]);
    // Simulate the request being accepted but slow to produce its first chunk.
    act(() => {
      useStreamingStatusStore.getState().setStatus(SUB, 'submitted');
    });

    vi.advanceTimersByTime(STUCK_MS);

    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('Restart button triggers hardRestartSubChat (transport delete + status clear)', () => {
    useStreamingStatusStore.getState().setStatus(SUB, 'ready');
    const store = seedUserMessage();
    const { container } = renderWithProviders(<ContinueButton subChatId={SUB} />, { store });

    fireEvent.click(container.querySelectorAll('button')[1]);

    expect(agentChatStore.delete).toHaveBeenCalledWith(SUB);
    expect(toast.info).toHaveBeenCalledWith('Agent restarted', expect.objectContaining({}));
  });

  it('Restart button cancels the pending stuck-detection timer', () => {
    const store = seedUserMessage();
    const { container } = renderWithProviders(<ContinueButton subChatId={SUB} />, { store });

    // Arm the timer
    fireEvent.click(container.querySelectorAll('button')[0]);
    // Then restart before the timer expires
    fireEvent.click(container.querySelectorAll('button')[1]);

    vi.advanceTimersByTime(STUCK_MS * 2);

    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('clears the stuck timer when the component unmounts', () => {
    const store = seedUserMessage();
    const { container, unmount } = renderWithProviders(<ContinueButton subChatId={SUB} />, { store });

    fireEvent.click(container.querySelectorAll('button')[0]);
    unmount();

    vi.advanceTimersByTime(STUCK_MS * 2);

    expect(toast.warning).not.toHaveBeenCalled();
  });
});
