// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// ── hoisted mock refs (must precede vi.mock calls) ────────────────────────────

const { mockPromptsQuery, mockSummaryQuery, mockRefresh } = vi.hoisted(() => ({
  mockPromptsQuery: vi.fn(),
  mockSummaryQuery: vi.fn(),
  mockRefresh: vi.fn()
}));

// ── tRPC mock ─────────────────────────────────────────────────────────────────

vi.mock('@/lib/trpc', () => ({
  trpc: {
    messages: { getSessionPrompts: { useQuery: mockPromptsQuery } },
    chats: { getSessionSummary: { useQuery: mockSummaryQuery } },
    useUtils: () => ({
      messages: { getSessionPrompts: { invalidate: vi.fn() } },
      chats: { getSessionSummary: { invalidate: vi.fn() } }
    })
  }
}));

// ── dispatcher hook mock (its internals are unit-tested elsewhere) ────────────

vi.mock('../../agents/hooks/use-session-summary-dispatcher', () => ({
  useSessionSummaryDispatcher: () => ({ refresh: mockRefresh, isGenerating: false })
}));

// ── busy atom + jotai (idle by default) ───────────────────────────────────────

vi.mock('../../agents/atoms', () => ({ subChatBusyAtomFamily: () => ({}) }));

vi.mock('jotai', async (importActual) => {
  const actual = await importActual<typeof import('jotai')>();
  return { ...actual, useAtomValue: () => false };
});

import { TooltipProvider } from '@/components/ui/tooltip';
import { SessionWidget } from './session-widget';

// The app mounts a global TooltipProvider; mirror it here so the refresh
// button's Tooltip can render.
const renderWidget = (props: { chatId: string; activeSubChatId: string | null }) =>
  render(
    <TooltipProvider>
      <SessionWidget {...props} />
    </TooltipProvider>
  );

afterEach(cleanup);

beforeEach(() => {
  mockRefresh.mockReset();
  mockPromptsQuery.mockReturnValue({
    data: {
      first: { id: 'm0', idx: 0, role: 'user', parts: '[]', metadata: null, text: 'Build the original feature' },
      last: { id: 'm9', idx: 9, role: 'user', parts: '[]', metadata: null, text: 'fix the last bug' }
    }
  });
  mockSummaryQuery.mockReturnValue({ data: { summary: 'Working on the feature.', updatedAt: null, stale: false } });
});

describe('SessionWidget [details-sidebar/session]', () => {
  test('renders original prompt, last input, and summary', () => {
    renderWidget({ chatId: 'c1', activeSubChatId: 'sc-1' });
    expect(screen.getByText('Original prompt')).toBeTruthy();
    expect(screen.getByText('Build the original feature')).toBeTruthy();
    expect(screen.getByText('Last input')).toBeTruthy();
    expect(screen.getByText('fix the last bug')).toBeTruthy();
    expect(screen.getByText('Working on the feature.')).toBeTruthy();
  });

  test('shows "No summary yet" when no summary exists', () => {
    mockSummaryQuery.mockReturnValue({ data: { summary: null, updatedAt: null, stale: false } });
    renderWidget({ chatId: 'c1', activeSubChatId: 'sc-1' });
    expect(screen.getByText('No summary yet')).toBeTruthy();
  });

  test('refresh button triggers a summary refresh', () => {
    renderWidget({ chatId: 'c1', activeSubChatId: 'sc-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh summary' }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  test('renders nothing without an active sub-chat', () => {
    const { container } = renderWidget({ chatId: 'c1', activeSubChatId: null });
    expect(container.firstChild).toBeNull();
  });
});
