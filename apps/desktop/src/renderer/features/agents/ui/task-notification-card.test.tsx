// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// Stub the markdown renderer (pulls Streamdown) — we only care that the result
// text is shown when expanded, not how it's parsed.
vi.mock('../../../components/chat-markdown-renderer', () => ({
  MemoizedMarkdown: ({ content }: { content: string }) => <div>{content}</div>
}));

import { TaskNotificationCard } from './task-notification-card';
import type { TaskNotification } from './task-notification';

afterEach(cleanup);

const data: TaskNotification = {
  taskId: 'a6626bc9d0f54f1dc',
  agentName: 'Explore Project Settings & schema',
  status: 'completed',
  summary: 'Agent "Explore Project Settings & schema" came to rest',
  result: 'EXPLORATION_REPORT_BODY',
  tokens: 64203,
  toolUses: 36,
  durationMs: 158522
};

describe('TaskNotificationCard [chat/task-notification]', () => {
  it('shows the agent name, status, and metadata collapsed; hides the report', () => {
    render(<TaskNotificationCard data={data} idPrefix="msg-0" />);
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('Explore Project Settings & schema');
    expect(button.textContent).toContain('completed');
    expect(button.textContent).toContain('64.2k tok');
    expect(button.textContent).toContain('36 uses');
    // Report body is not rendered until expanded.
    expect(screen.queryByText('EXPLORATION_REPORT_BODY')).toBeNull();
  });

  it('reveals the markdown report when the header is clicked', () => {
    render(<TaskNotificationCard data={data} idPrefix="msg-0" />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('EXPLORATION_REPORT_BODY')).toBeTruthy();
  });

  it('omits a metadata segment when its value is missing', () => {
    render(
      <TaskNotificationCard
        data={{ ...data, tokens: undefined, toolUses: undefined, durationMs: undefined }}
        idPrefix="msg-1"
      />
    );
    const button = screen.getByRole('button');
    expect(button.textContent).not.toContain('tok');
    expect(button.textContent).not.toContain('uses');
  });
});
