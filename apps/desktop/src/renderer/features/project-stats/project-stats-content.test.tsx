// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Provider } from 'jotai';
import { renderWithProviders } from '../../../../test-utils';
import { createTestStore } from '../../../../test-utils/create-test-store';
import { TooltipProvider } from '../../components/ui/tooltip';
import { projectStatsTargetIdAtom, selectedProjectAtom } from '../../lib/atoms';
import { ProjectStatsContent } from './project-stats-content';

afterEach(cleanup);

vi.mock('../../features/agents/ui/agents-header-controls', () => ({
  AgentsHeaderControls: () => <div data-testid="header-controls" />
}));
vi.mock('../../lib/hooks/use-mobile', () => ({
  useIsMobile: () => false
}));

// useQuery and useMutation are replaced via vi.mock; behavior is controlled by
// overwriting the mock implementation per test with mockReturnValue.
const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn(() => ({ mutate: vi.fn(), isPending: false }));

vi.mock('../../lib/trpc', () => ({
  trpc: {
    projectStats: {
      getStats: { useQuery: (...args: unknown[]) => mockUseQuery(...args) },
      refresh: { useMutation: (...args: unknown[]) => mockUseMutation(...args) }
    }
  }
}));

const baseProject = {
  id: 'proj-1',
  name: 'My Repo',
  path: '/home/user/my-repo',
  gitRemoteUrl: null,
  gitProvider: null,
  gitOwner: null,
  gitRepo: null
};

function setup(queryReturnValue: object) {
  mockUseQuery.mockReturnValue(queryReturnValue);
  const store = createTestStore();
  store.set(projectStatsTargetIdAtom, 'proj-1');
  store.set(selectedProjectAtom, baseProject);
  render(
    <Provider store={store}>
      <TooltipProvider>
        <ProjectStatsContent />
      </TooltipProvider>
    </Provider>
  );
  return store;
}

describe('ProjectStatsContent', () => {
  it('shows loading skeleton while query is loading', () => {
    setup({ isLoading: true, isError: false, data: undefined, isFetching: false, refetch: vi.fn() });
    expect(screen.queryByText(/Failed to load/i)).toBeNull();
    // Stat card labels are not rendered during loading
    expect(screen.queryByText('Top contributors')).toBeNull();
  });

  it('shows error banner when query returns ok:false', () => {
    setup({
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
      data: { ok: false, error: 'Not a git repository' }
    });
    expect(screen.getByText('Not a git repository')).toBeTruthy();
  });

  it('shows network error banner when query has isError:true', () => {
    setup({
      isLoading: false,
      isError: true,
      error: { message: 'Network error' },
      isFetching: false,
      refetch: vi.fn(),
      data: undefined
    });
    expect(screen.getByText(/Failed to load statistics/i)).toBeTruthy();
  });

  it('renders stat cards and sections on success', () => {
    const mockData = {
      period: '90d',
      totals: {
        commitsInPeriod: 42,
        commitsAllTime: 100,
        contributorsInPeriod: 3,
        branches: 2,
        tags: 5,
        additions: 1000,
        deletions: 200,
        firstCommitISO: '2020-01-01T00:00:00+00:00',
        lastCommitISO: '2026-04-30T12:00:00+00:00'
      },
      heatmap: [],
      daily: [{ date: '2026-04-01', commits: 5 }],
      contributors: [{ name: 'Alice', email: 'alice@example.com', commits: 20, additions: 500, deletions: 100 }],
      recent: [{ hash: 'abc1234def', author: 'Alice', dateISO: '2026-04-30T12:00:00+00:00', subject: 'Fix bug' }],
      warnings: []
    };

    setup({
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
      data: { ok: true, data: mockData }
    });

    expect(screen.getAllByText('Commits').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Contributors').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Local branches')).toBeTruthy();
    expect(screen.getByText('Tags')).toBeTruthy();
    expect(screen.getAllByText('Additions').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Deletions').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Top contributors')).toBeTruthy();
    expect(screen.getByText('Recent commits')).toBeTruthy();
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Fix bug')).toBeTruthy();
  });

  it('shows shallow clone warning when present', () => {
    const mockData = {
      period: '90d',
      totals: {
        commitsInPeriod: 1,
        commitsAllTime: 1,
        contributorsInPeriod: 1,
        branches: 1,
        tags: 0,
        additions: 5,
        deletions: 2,
        firstCommitISO: null,
        lastCommitISO: null
      },
      heatmap: [],
      daily: [],
      contributors: [],
      recent: [],
      warnings: ['Repository is shallow — commit counts may be partial']
    };

    setup({
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
      data: { ok: true, data: mockData }
    });
    expect(screen.getByText(/Repository is shallow/)).toBeTruthy();
  });
});
