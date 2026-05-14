// @vitest-environment jsdom
/**
 * Task 10.7 — Refresh / Recheck / Retry controls
 * Tests that clicking each invalidation button calls the correct tRPC utils method.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { cleanup, screen, fireEvent } from '@testing-library/react';
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

const mockUtils = {
  newProject: {
    listAccounts: { invalidate: mockListAccountsInvalidate },
    listProjects: { invalidate: mockListProjectsInvalidate },
    detectCli: { invalidate: mockDetectCliInvalidate },
    checkAuth: { invalidate: mockCheckAuthInvalidate }
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
  it('calls utils.newProject.detectCli.invalidate when Recheck is clicked', () => {
    mockDetectCliQuery.mockReturnValue({ data: { available: false }, isFetching: false });
    const store = createTestStore();
    renderWithProviders(<CliInstallInstructions provider="github" />, { store });

    const recheckBtn = screen.getByRole('button', { name: /recheck/i });
    fireEvent.click(recheckBtn);

    expect(mockDetectCliInvalidate).toHaveBeenCalled();
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
  it('calls utils.newProject.checkAuth.invalidate when Retry is clicked', () => {
    mockCheckAuthQuery.mockReturnValue({ data: { ok: false, code: 'not-authenticated' }, isFetching: false });
    const store = createTestStore();
    renderWithProviders(<AuthRequiredPanel provider="github" />, { store });

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);

    expect(mockCheckAuthInvalidate).toHaveBeenCalledWith({ provider: 'github', evictCache: false });
  });

  it('shows spinner on Retry button while fetching', () => {
    mockCheckAuthQuery.mockReturnValue({ data: { ok: false, code: 'not-authenticated' }, isFetching: true });
    const store = createTestStore();
    renderWithProviders(<AuthRequiredPanel provider="github" />, { store });

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect((retryBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
