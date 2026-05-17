// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

// ── hoisted mock refs (must precede vi.mock calls) ────────────────────────────

const { mockIsStreaming, mockGetCurrentTasksQuery } = vi.hoisted(() => ({
  mockIsStreaming: vi.fn(() => false),
  mockGetCurrentTasksQuery: vi.fn()
}));

// ── streaming status mock ─────────────────────────────────────────────────────

vi.mock('@/features/agents/stores/streaming-status-store', () => ({
  useStreamingStatusStore: (selector: (s: { isStreaming: (k: string) => boolean }) => unknown) =>
    selector({ isStreaming: mockIsStreaming })
}));

// ── message-store mock (no messages → no running tools) ───────────────────────

vi.mock('@/features/agents/stores/message-store', () => ({
  getPerChatMessageKey: (cid: string, id: string) => `${cid}:${id}`,
  messageAtomFamily: () => ({ init: null }),
  messageIdsPerChatAtom: () => ({ init: [] })
}));

vi.mock('@/features/agents/ui/agent-tool-utils', () => ({
  resolvePartStartedAt: () => undefined,
  summarizeToolInput: () => ''
}));

// ── tRPC mock ─────────────────────────────────────────────────────────────────

vi.mock('@/lib/trpc', () => ({
  trpc: {
    chats: {
      getCurrentTasks: {
        useQuery: mockGetCurrentTasksQuery
      }
    }
  }
}));

// ── atom mock (jotai) ─────────────────────────────────────────────────────────

vi.mock('jotai', async (importActual) => {
  const actual = await importActual<typeof import('jotai')>();
  return {
    ...actual,
    useAtomValue: () => null
  };
});

import { TasksWidget } from './tasks-widget';

afterEach(cleanup);

beforeEach(() => {
  mockIsStreaming.mockReturnValue(false);
  mockGetCurrentTasksQuery.mockReturnValue({ data: { exists: false } });
});

describe('TasksWidget — plan-progress section [tasks-widget/plan-progress]', () => {
  test('renders null when not streaming and no persisted tasks', () => {
    const { container } = render(<TasksWidget subChatId="sc-1" />);
    expect(container.firstChild).toBeNull();
  });

  test('renders plan-progress card when persisted tasks exist and not streaming', () => {
    mockGetCurrentTasksQuery.mockReturnValue({
      data: {
        exists: true,
        tasks: [
          { id: 'step-1', title: 'Build the thing', status: 'completed' },
          { id: 'step-2', title: 'Test it', status: 'in_progress' },
          { id: 'step-3', title: 'Ship it', status: 'pending' }
        ],
        meta: { source: 'test', updatedAt: new Date().toISOString() }
      }
    });

    render(<TasksWidget subChatId="sc-2" />);

    expect(screen.getByText('Plan progress')).toBeTruthy();
    expect(screen.getByText('Build the thing')).toBeTruthy();
    expect(screen.getByText('Test it')).toBeTruthy();
    expect(screen.getByText('Ship it')).toBeTruthy();
    expect(screen.getByText('1/3')).toBeTruthy();

    // Running-tools card must NOT appear (not streaming)
    expect(screen.queryByText('Tasks')).toBeNull();
  });

  test('renders running-tools card when streaming and no persisted tasks', () => {
    mockIsStreaming.mockReturnValue(true);

    render(<TasksWidget subChatId="sc-3" />);

    expect(screen.getByText('Tasks')).toBeTruthy();
    // Plan-progress card should not appear (no persisted tasks)
    expect(screen.queryByText('Plan progress')).toBeNull();
  });

  test('renders both cards when streaming AND persisted tasks exist', () => {
    mockIsStreaming.mockReturnValue(true);
    mockGetCurrentTasksQuery.mockReturnValue({
      data: {
        exists: true,
        tasks: [{ id: 'step-1', title: 'Do the thing', status: 'pending' }],
        meta: { source: 'test', updatedAt: new Date().toISOString() }
      }
    });

    render(<TasksWidget subChatId="sc-4" />);

    expect(screen.getByText('Plan progress')).toBeTruthy();
    expect(screen.getByText('Tasks')).toBeTruthy();
  });
});
