// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WorkflowState } from '../utils/workflow-state';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    changes: {
      getStatus: { useQuery: () => ({ data: undefined }) }
    }
  }
}));

// File-change listener pokes the IPC bridge — no-op it in the DOM test.
vi.mock('../../../lib/hooks/use-file-change-listener', () => ({
  useFileChangeListener: () => {}
}));

import { SubChatStatusCard } from './sub-chat-status-card';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const terminalWorkflow: WorkflowState = {
  plan: { id: 'plan', status: 'done', label: 'Plan', hint: 'Done' },
  code: { id: 'code', status: 'done', label: 'Code', hint: 'Merged' },
  review: { id: 'review', status: 'done', label: 'Review', hint: 'Merged' },
  pr: { id: 'pr', status: 'done', label: 'PR', hint: 'PR merged' },
  next: null,
  mergedBranchGone: true
};

function renderCard(props: Partial<React.ComponentProps<typeof SubChatStatusCard>> = {}) {
  const onWorkflowAction = vi.fn();
  render(
    <SubChatStatusCard
      chatId="chat-1"
      subChatId="sub-1"
      isStreaming={false}
      changedFiles={[]}
      worktreePath="/tmp/wt"
      workflow={terminalWorkflow}
      onWorkflowAction={onWorkflowAction}
      {...props}
    />
  );
  return { onWorkflowAction };
}

describe('SubChatStatusCard — merged branch gone (terminal cluster)', () => {
  it('renders Archive workspace + Re-open branch buttons and the merged label', () => {
    renderCard();
    expect(screen.getByText('Branch merged')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archive workspace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Re-open branch' })).toBeTruthy();
  });

  it('dispatches archiveWorkspace when Archive is clicked', () => {
    const { onWorkflowAction } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Archive workspace' }));
    expect(onWorkflowAction).toHaveBeenCalledWith('archiveWorkspace');
  });

  it('dispatches reopenBranch when Re-open is clicked', () => {
    const { onWorkflowAction } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Re-open branch' }));
    expect(onWorkflowAction).toHaveBeenCalledWith('reopenBranch');
  });

  it('disables the buttons while their action is pending', () => {
    renderCard({ actionPending: { archiveWorkspace: true, reopenBranch: true } });
    expect(screen.getByRole('button', { name: 'Archive workspace' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Re-open branch' })).toHaveProperty('disabled', true);
  });

  it('does not render the terminal cluster when mergedBranchGone is false', () => {
    renderCard({ workflow: { ...terminalWorkflow, mergedBranchGone: false } });
    expect(screen.queryByRole('button', { name: 'Archive workspace' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Re-open branch' })).toBeNull();
  });
});
