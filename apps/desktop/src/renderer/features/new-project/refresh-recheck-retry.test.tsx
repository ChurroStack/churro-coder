// @vitest-environment jsdom
/**
 * Task 10.7 — Refresh / Recheck / Retry controls
 * Tests that clicking each invalidation button calls the correct tRPC utils method.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { cleanup, screen, fireEvent, act } from '@testing-library/react';
import { createTestStore, renderWithProviders } from '../../../../test-utils';
import { newProjectDraftAtom } from './atoms';
import { AccountOrgPicker } from './account-org-picker';
import { AzureProjectPicker } from './azure-project-picker';
import { CliInstallInstructions } from './cli-install-instructions';
import { AuthRequiredPanel } from './auth-required-panel';

afterEach(cleanup);

// ── tRPC mock setup ───────────────────────────────────────────────────────────

const mockListAccountsInvalidate = vi.fn();
const mockListProjectsInvalidate = vi.fn();
const mockDetectCliInvalidate = vi.fn();
const mockCheckAuthInvalidate = vi.fn();
const mockDetectCliFetch = vi.fn(async () => ({ available: true, version: '2.0.0' }));
const mockDetectCliSetData = vi.fn();
const mockCheckAuthFetch = vi.fn(async () => ({ ok: true }));
const mockCheckAuthSetData = vi.fn();

const mockUtils = {
  newProject: {
    listAccounts: { invalidate: mockListAccountsInvalidate },
    listProjects: { invalidate: mockListProjectsInvalidate },
    detectCli: {
      invalidate: mockDetectCliInvalidate,
      fetch: mockDetectCliFetch,
      setData: mockDetectCliSetData
    },
    checkAuth: {
      invalidate: mockCheckAuthInvalidate,
      fetch: mockCheckAuthFetch,
      setData: mockCheckAuthSetData
    }
  }
};

const mockListAccountsQuery = vi.fn(() => ({
  data: [] as { id: string; label: string; badge: string }[],
  isFetching: false
}));
const mockListProjectsQuery = vi.fn(() => ({
  data: undefined as { id: string; name: string }[] | undefined,
  isFetching: false
}));
const mockDetectCliQuery = vi.fn(() => ({
  data: undefined as { available: boolean } | undefined,
  isFetching: false
}));
const mockCheckAuthQuery = vi.fn(() => ({
  data: undefined as { ok: boolean; code?: string } | undefined,
  isFetching: false
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => mockUtils),
    newProject: {
      listAccounts: { useQuery: (...a: unknown[]) => (mockListAccountsQuery as (...args: unknown[]) => unknown)(...a) },
      listProjects: { useQuery: (...a: unknown[]) => (mockListProjectsQuery as (...args: unknown[]) => unknown)(...a) },
      detectCli: { useQuery: (...a: unknown[]) => (mockDetectCliQuery as (...args: unknown[]) => unknown)(...a) },
      checkAuth: { useQuery: (...a: unknown[]) => (mockCheckAuthQuery as (...args: unknown[]) => unknown)(...a) }
    }
  }
}));

// Default to 'unknown' so existing tests keep their macOS-fallback behavior;
// platform-specific tests override per-test via mockGetPlatform.mockReturnValue(...).
const mockGetPlatform = vi.fn<() => 'darwin' | 'win32' | 'linux' | 'unknown'>(() => 'unknown');
vi.mock('@/lib/utils/platform', () => ({
  getPlatform: () => mockGetPlatform()
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ── (a) AccountOrgPicker Refresh ──────────────────────────────────────────────

describe('AccountOrgPicker — Refresh button', () => {
  it('calls utils.newProject.listAccounts.invalidate when Refresh is clicked', () => {
    mockListAccountsQuery.mockReturnValue({
      data: [{ id: 'user', label: 'user', badge: 'Personal' }],
      isFetching: false
    });
    const store = createTestStore();
    store.set(newProjectDraftAtom, { ...store.get(newProjectDraftAtom), provider: 'github' });
    renderWithProviders(<AccountOrgPicker />, { store });

    const refreshBtn = screen.getByRole('button');
    fireEvent.click(refreshBtn);

    expect(mockListAccountsInvalidate).toHaveBeenCalledWith({ provider: 'github' });
  });
});

// ── (b) AzureProjectPicker Refresh ───────────────────────────────────────────

describe('AzureProjectPicker — Refresh button', () => {
  it('calls utils.newProject.listProjects.invalidate when Refresh is clicked', () => {
    mockListProjectsQuery.mockReturnValue({ data: [{ id: 'proj-1', name: 'MyProject' }], isFetching: false });
    const store = createTestStore();
    store.set(newProjectDraftAtom, {
      ...store.get(newProjectDraftAtom),
      provider: 'azure',
      accountId: 'https://dev.azure.com/myorg'
    });
    renderWithProviders(<AzureProjectPicker />, { store });

    const refreshBtn = screen.getByRole('button');
    fireEvent.click(refreshBtn);

    expect(mockListProjectsInvalidate).toHaveBeenCalledWith({
      provider: 'azure',
      accountId: 'https://dev.azure.com/myorg'
    });
  });
});

// ── (c) CliInstallInstructions Recheck ───────────────────────────────────────

describe('CliInstallInstructions — Recheck button', () => {
  // Regression: previously called `invalidate({ provider, evictCache: true })`, which only
  // affected the cache key used for matching; the refetch still ran with the displayed
  // query's input (`evictCache: false`), so the main-process 60 s cache was never busted.
  it('imperatively fetches with evictCache:true and pushes the result into the displayed slot', async () => {
    mockDetectCliQuery.mockReturnValue({ data: { available: false }, isFetching: false });
    mockDetectCliFetch.mockResolvedValueOnce({ available: true, version: '2.50.0' });
    const store = createTestStore();
    renderWithProviders(<CliInstallInstructions provider="github" />, { store });

    const recheckBtn = screen.getByRole('button', { name: /recheck/i });
    await act(async () => {
      fireEvent.click(recheckBtn);
    });

    expect(mockDetectCliFetch).toHaveBeenCalledWith({ provider: 'github', evictCache: true });
    expect(mockDetectCliSetData).toHaveBeenCalledWith(
      { provider: 'github', evictCache: false },
      {
        available: true,
        version: '2.50.0'
      }
    );
  });

  it('shows spinner on Recheck button while fetching', () => {
    mockDetectCliQuery.mockReturnValue({ data: { available: false }, isFetching: true });
    const store = createTestStore();
    renderWithProviders(<CliInstallInstructions provider="github" />, { store });

    const recheckBtn = screen.getByRole('button', { name: /recheck/i });
    expect((recheckBtn as HTMLButtonElement).disabled).toBe(true);
  });
});

// ── (d) AuthRequiredPanel Retry ───────────────────────────────────────────────

describe('AuthRequiredPanel — Retry button', () => {
  // Regression: previously called `invalidate({ provider, evictCache: false })`, which
  // refetched the React Query but the main-process kept returning its cached negative
  // auth result for up to 60 s — so the user saw the button do "nothing" after running
  // `gh auth login`.
  it('imperatively fetches with evictCache:true and pushes the result into the displayed slot', async () => {
    mockCheckAuthQuery.mockReturnValue({ data: { ok: false, code: 'not-authenticated' }, isFetching: false });
    mockCheckAuthFetch.mockResolvedValueOnce({ ok: true });
    const store = createTestStore();
    renderWithProviders(<AuthRequiredPanel provider="github" />, { store });

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    await act(async () => {
      fireEvent.click(retryBtn);
    });

    expect(mockCheckAuthFetch).toHaveBeenCalledWith({ provider: 'github', evictCache: true });
    expect(mockCheckAuthSetData).toHaveBeenCalledWith({ provider: 'github', evictCache: false }, { ok: true });
  });

  it('shows spinner on Retry button while fetching', () => {
    mockCheckAuthQuery.mockReturnValue({ data: { ok: false, code: 'not-authenticated' }, isFetching: true });
    const store = createTestStore();
    renderWithProviders(<AuthRequiredPanel provider="github" />, { store });

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect((retryBtn as HTMLButtonElement).disabled).toBe(true);
  });
});

// ── (e) CliInstallInstructions platform-specific install commands ────────────

describe('CliInstallInstructions — platform-specific install commands', () => {
  // Regression: install commands were hard-coded to macOS (`brew install ...`)
  // even when the app ran on Windows or Linux. Switch on getPlatform() so each
  // OS sees the canonical one-liner from the tool's official docs.
  function renderFor(provider: 'github' | 'azure' | 'local', platform: 'darwin' | 'win32' | 'linux') {
    mockGetPlatform.mockReturnValue(platform);
    mockDetectCliQuery.mockReturnValue({ data: { available: false }, isFetching: false });
    const store = createTestStore();
    renderWithProviders(<CliInstallInstructions provider={provider} />, { store });
  }

  it('shows winget command for gh on Windows', () => {
    renderFor('github', 'win32');
    expect(screen.getByText('winget install --id GitHub.cli')).toBeTruthy();
    expect(screen.queryByText('brew install gh')).toBeNull();
  });

  it('shows brew command for gh on macOS', () => {
    renderFor('github', 'darwin');
    expect(screen.getByText('brew install gh')).toBeTruthy();
  });

  it('shows apt command for gh on Linux', () => {
    renderFor('github', 'linux');
    expect(screen.getByText(/sudo apt install gh/)).toBeTruthy();
  });

  it('shows winget command for az on Windows', () => {
    renderFor('azure', 'win32');
    expect(screen.getByText('winget install Microsoft.AzureCLI')).toBeTruthy();
    expect(screen.queryByText('brew install azure-cli')).toBeNull();
  });

  it('shows the Microsoft Linux installer one-liner for az on Linux', () => {
    renderFor('azure', 'linux');
    expect(screen.getByText(/aka\.ms\/InstallAzureCLIDeb/)).toBeTruthy();
  });

  it('shows winget command for git on Windows (local provider)', () => {
    renderFor('local', 'win32');
    expect(screen.getByText('winget install --id Git.Git')).toBeTruthy();
  });
});
