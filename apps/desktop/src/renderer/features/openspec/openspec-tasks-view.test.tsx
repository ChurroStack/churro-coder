// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { useStreamingStatusStore } from '../agents/stores/streaming-status-store';

const mockReadChangeFileUseQuery = vi.fn();
const mockWriteChangeFileMutate = vi.fn();

vi.mock('../../lib/trpc', () => ({
  trpc: {
    openspec: {
      readChangeFile: {
        useQuery: (...args: unknown[]) => mockReadChangeFileUseQuery(...args)
      },
      writeChangeFile: {
        useMutation: () => ({ mutate: mockWriteChangeFileMutate })
      }
    }
  }
}));

vi.mock('./use-openspec-action', () => ({
  useOpenSpecAction: () => vi.fn()
}));

import { OpenSpecTasksView } from './openspec-tasks-view';

const tasksContent = `## 1. Implementation
- [x] 1.1 First task
- [ ] 1.2 Second task
`;

function renderTasksView() {
  return render(
    <OpenSpecTasksView
      chatId="chat-1"
      subChatId="sub-1"
      projectId="project-1"
      changeId="change-1"
      changePath="openspec/changes/change-1"
      onCodeReview={() => {}}
    />
  );
}

describe('OpenSpecTasksView', () => {
  beforeEach(() => {
    useStreamingStatusStore.setState({ statuses: {} });
    mockReadChangeFileUseQuery.mockReturnValue({
      data: { content: tasksContent, modifiedAt: new Date().toISOString() },
      isLoading: false,
      error: null
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useStreamingStatusStore.setState({ statuses: {} });
  });

  it('reads tasks.md without polling', () => {
    renderTasksView();

    expect(mockReadChangeFileUseQuery).toHaveBeenCalledWith(
      { chatId: 'chat-1', changeId: 'change-1', kind: 'tasks' },
      { staleTime: 30_000 }
    );
  });

  it('shows a working state while the apply session streams', () => {
    useStreamingStatusStore.getState().setStatus('sub-1', 'streaming');

    renderTasksView();

    expect(screen.getByText('Implementing…')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();

    const implementButton = screen.getByRole('button', { name: /implementing tasks/i }) as HTMLButtonElement;
    expect(implementButton.disabled).toBe(true);
    expect(implementButton.querySelector('svg')?.getAttribute('class') ?? '').toContain('animate-spin');
  });

  it('shows a confirmation dialog when manually checking an unchecked task', () => {
    renderTasksView();

    // Find the checkbox for the unchecked task (1.2 Second task).
    // There are 2 checkboxes: index 0 is already checked (1.1), index 1 is unchecked (1.2).
    const checkboxes = screen.getAllByRole('checkbox') as HTMLButtonElement[];
    const uncheckedBox = checkboxes[1]!;
    fireEvent.click(uncheckedBox);

    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('Mark task as done?')).toBeTruthy();
    expect(screen.getByText('Confirm you have completed this step manually.')).toBeTruthy();
  });

  it('writes updated content to tasks.md on confirm', () => {
    renderTasksView();

    const checkboxes = screen.getAllByRole('checkbox') as HTMLButtonElement[];
    fireEvent.click(checkboxes[1]!);

    const confirmButton = screen.getByRole('button', { name: /mark done/i });
    fireEvent.click(confirmButton);

    expect(mockWriteChangeFileMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        changeId: 'change-1',
        kind: 'tasks',
        content: expect.stringContaining('[x] 1.2 Second task')
      }),
      expect.any(Object)
    );
  });

  it('dismisses dialog without writing on cancel', () => {
    renderTasksView();

    const checkboxes = screen.getAllByRole('checkbox') as HTMLButtonElement[];
    fireEvent.click(checkboxes[1]!);

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(mockWriteChangeFileMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
