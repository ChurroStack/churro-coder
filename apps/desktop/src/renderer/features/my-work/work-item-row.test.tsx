// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WorkItemRow } from './work-item-row';
import type { WorkItem } from '../../../main/lib/work-items/types';

// ChatMarkdownRenderer uses streamdown / shiki which are not available in jsdom
vi.mock('../../components/chat-markdown-renderer', () => ({
  ChatMarkdownRenderer: ({ content }: { content: string }) => <div data-testid="markdown-body">{content}</div>
}));

afterEach(cleanup);

const baseItem: WorkItem = {
  id: 'github:owner/repo#42',
  number: 42,
  title: 'Fix login timeout',
  body: 'Users report that sessions expire too quickly.',
  state: 'OPEN',
  type: 'issue',
  url: 'https://github.com/owner/repo/issues/42',
  labels: [],
  updatedAt: new Date('2026-06-01T10:00:00Z').toISOString(),
  createdAt: new Date('2026-05-01T10:00:00Z').toISOString(),
  provider: 'github',
  repoOwner: 'owner',
  repoName: 'repo'
};

describe('WorkItemRow [my-work/work-item-row]', () => {
  test('renders issue title and repo ref', () => {
    render(<WorkItemRow item={baseItem} onStartSession={() => {}} />);
    expect(screen.getByText('Fix login timeout')).toBeDefined();
    expect(screen.getByText(/owner\/repo #42/)).toBeDefined();
  });

  test('renders labels when present', () => {
    const item: WorkItem = {
      ...baseItem,
      labels: [{ name: 'bug', color: 'ee0701' }]
    };
    render(<WorkItemRow item={item} onStartSession={() => {}} />);
    expect(screen.getByText('bug')).toBeDefined();
  });

  test('renders GitHub issue badges', () => {
    render(<WorkItemRow item={baseItem} onStartSession={() => {}} />);
    expect(screen.getByText('Issue')).toBeDefined();
    expect(screen.getByText('GitHub')).toBeDefined();
  });

  test('calls onStartSession with the item when Start session button clicked', () => {
    let called: WorkItem | null = null;
    render(
      <WorkItemRow
        item={baseItem}
        onStartSession={(item) => {
          called = item;
        }}
      />
    );
    const btn = screen.getByRole('button', { name: /start session/i });
    fireEvent.click(btn);
    expect(called).toBe(baseItem);
  });

  test('calls onCloneAndStart when the repo is not available locally', () => {
    let called: WorkItem | null = null;
    render(
      <WorkItemRow
        item={baseItem}
        hasLocalProject={false}
        onStartSession={() => {}}
        onCloneAndStart={(item) => {
          called = item;
        }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /clone and start session for issue #42/i }));
    expect(called).toBe(baseItem);
  });

  test('has accessible link to view on GitHub', () => {
    render(<WorkItemRow item={baseItem} onStartSession={() => {}} />);
    const link = screen.getByRole('link', { name: /open issue #42/i });
    expect(link).toBeDefined();
    expect((link as HTMLAnchorElement).href).toContain('github.com/owner/repo/issues/42');
  });

  test('renders listitem role with descriptive label', () => {
    render(<WorkItemRow item={baseItem} onStartSession={() => {}} />);
    const row = screen.getByRole('listitem', { name: /issue #42/i });
    expect(row).toBeDefined();
  });

  test('description is hidden by default', () => {
    render(<WorkItemRow item={baseItem} onStartSession={() => {}} />);
    expect(screen.queryByTestId('markdown-body')).toBeNull();
  });

  test('clicking expand button shows the issue description', () => {
    render(<WorkItemRow item={baseItem} onStartSession={() => {}} />);
    const toggle = screen.getByRole('button', { name: /expand issue #42/i });
    fireEvent.click(toggle);
    expect(screen.getByTestId('markdown-body')).toBeDefined();
    expect(screen.getByTestId('markdown-body').textContent).toContain(baseItem.body);
  });

  test('clicking expand again hides the description', () => {
    render(<WorkItemRow item={baseItem} onStartSession={() => {}} />);
    const toggle = screen.getByRole('button', { name: /expand issue #42/i });
    fireEvent.click(toggle);
    expect(screen.getByTestId('markdown-body')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /collapse issue #42/i }));
    expect(screen.queryByTestId('markdown-body')).toBeNull();
  });

  test('expand button is disabled when issue has no body', () => {
    const item: WorkItem = { ...baseItem, body: '' };
    render(<WorkItemRow item={item} onStartSession={() => {}} />);
    const toggle = screen.getByRole('button', { name: /expand issue #42/i });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
  });

  test('shows Resume session button instead of Start session when resumeChatId is set', () => {
    render(
      <WorkItemRow item={baseItem} resumeChatId="chat-abc" onStartSession={() => {}} onResumeSession={() => {}} />
    );
    expect(screen.getByRole('button', { name: /resume session for issue #42/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /start session/i })).toBeNull();
  });

  test('calls onResumeSession with the chatId when Resume session clicked', () => {
    let resumedId: string | null = null;
    render(
      <WorkItemRow
        item={baseItem}
        resumeChatId="chat-xyz"
        onStartSession={() => {}}
        onResumeSession={(id) => {
          resumedId = id;
        }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /resume session for issue #42/i }));
    expect(resumedId).toBe('chat-xyz');
  });
});
