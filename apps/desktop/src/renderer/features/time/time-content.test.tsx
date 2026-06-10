// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'jotai';
import { createTestStore } from '../../../../test-utils/create-test-store';
import { TooltipProvider } from '../../components/ui/tooltip';
import { TimeContent } from './time-content';
import { formatTimestamp } from './lib/format';

afterEach(cleanup);

vi.mock('../../features/agents/ui/agents-header-controls', () => ({
  AgentsHeaderControls: () => <div data-testid="header-controls" />
}));
vi.mock('../../lib/hooks/use-mobile', () => ({
  useIsMobile: () => false
}));

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn(() => ({ mutate: vi.fn(), isPending: false }));
const mockOpenInFinder = vi.fn();

vi.mock('../../lib/trpc', () => ({
  trpc: {
    time: {
      getOverview: { useQuery: (...args: unknown[]) => (mockUseQuery as (...a: unknown[]) => unknown)(...args) },
      refresh: { useMutation: (...args: unknown[]) => (mockUseMutation as (...a: unknown[]) => unknown)(...args) }
    },
    external: {
      openInFinder: { useMutation: () => ({ mutate: mockOpenInFinder, isPending: false }) }
    }
  }
}));

function setup(queryReturnValue: object) {
  mockUseQuery.mockReturnValue(queryReturnValue);
  const store = createTestStore();
  render(
    <Provider store={store}>
      <TooltipProvider>
        <TimeContent />
      </TooltipProvider>
    </Provider>
  );
  return store;
}

const successData = {
  period: 'thisMonth',
  groupSpendBy: 'harness',
  rangeStart: '2026-06-01',
  rangeEnd: '2026-06-10',
  totals: {
    runtimeMs: (3 * 60 + 42) * 60_000,
    totalTokens: 12_345,
    costUsd: 4.2,
    otherCostUsd: 0.5,
    anyUnpriced: true
  },
  spendBreakdown: [{ label: 'claude-cli', costUsd: 3.2, totalTokens: 10_000 }],
  daily: [{ date: '2026-06-10', runtimeMs: 60_000, costUsd: 1 }],
  projects: [
    {
      projectId: 'p1',
      projectName: 'My Repo',
      projectPath: '/Users/me/Projects/My Repo',
      runtimeMs: (3 * 60 + 42) * 60_000,
      totalTokens: 12_345,
      costUsd: 4.2,
      workspaces: [
        {
          chatId: 'c1',
          chatName: 'feature branch',
          runtimeMs: 60_000,
          totalTokens: 12_345,
          costUsd: 4.2,
          sessions: [
            {
              subChatId: 's1',
              subChatName: 'plan it',
              harness: 'claude-cli',
              runtimeMs: 60_000,
              startedAt: Date.parse('2026-06-19T12:43:00'),
              totalTokens: 12_345,
              costUsd: 4.2,
              models: [
                { source: 'claude', model: 'claude-opus-4-8', totalTokens: 12_345, costUsd: 4.2, unpriced: false }
              ]
            }
          ]
        }
      ]
    }
  ]
};

describe('TimeContent', () => {
  it('shows loading skeleton while loading', () => {
    setup({ isLoading: true, isError: false, data: undefined, isFetching: false, refetch: vi.fn() });
    expect(screen.getByRole('heading', { name: 'Time' })).toBeTruthy();
    expect(screen.queryByText('Projects')).toBeNull();
  });

  it('shows error banner on query error', () => {
    setup({
      isLoading: false,
      isError: true,
      error: { message: 'boom' },
      data: undefined,
      isFetching: false,
      refetch: vi.fn()
    });
    expect(screen.getByText(/Failed to load time data/i)).toBeTruthy();
  });

  it('renders totals, spend breakdown, and the project/workspace/session tree', () => {
    setup({ isLoading: false, isError: false, isFetching: false, refetch: vi.fn(), data: successData });

    // Totals (3h 42m appears in the Runtime card, the bar chart, and the project header)
    expect(screen.getByText('Runtime')).toBeTruthy();
    expect(screen.getAllByText('3h 42m').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Total Cost')).toBeTruthy();
    // Runtime-by-project bar chart
    expect(screen.getByText('Runtime by project')).toBeTruthy();

    // Spend breakdown (harness axis → "Claude CLI" label)
    expect(screen.getByText('Spend by harness')).toBeTruthy();
    expect(screen.getAllByText('Claude CLI').length).toBeGreaterThanOrEqual(1);

    // Tree (My Repo appears in both the bar chart and the project header)
    expect(screen.getAllByText('My Repo').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('feature branch')).toBeTruthy();
    expect(screen.getByText(/plan it/)).toBeTruthy();
    expect(screen.getByText('claude-opus-4-8')).toBeTruthy();

    // Caveat notes
    expect(screen.getByText(/maps to no known project/i)).toBeTruthy();
    expect(screen.getByText(/missing from the pricing table/i)).toBeTruthy();
  });

  it('collapses projects by default and expands on click', () => {
    setup({ isLoading: false, isError: false, isFetching: false, refetch: vi.fn(), data: successData });
    const header = screen.getByRole('button', { name: /My Repo/ });
    expect(header.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows a created-at hint per session', () => {
    setup({ isLoading: false, isError: false, isFetching: false, refetch: vi.fn(), data: successData });
    const expected = formatTimestamp(Date.parse('2026-06-19T12:43:00'));
    expect(screen.getByText((c) => c.includes(expected))).toBeTruthy();
  });

  it('shows the project base path and opens it via the external-link button', () => {
    setup({ isLoading: false, isError: false, isFetching: false, refetch: vi.fn(), data: successData });
    expect(screen.getByText('/Users/me/Projects/My Repo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open project folder' }));
    expect(mockOpenInFinder).toHaveBeenCalledWith('/Users/me/Projects/My Repo');
  });

  it('exposes a refresh control', () => {
    setup({ isLoading: false, isError: false, isFetching: false, refetch: vi.fn(), data: successData });
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
  });
});
