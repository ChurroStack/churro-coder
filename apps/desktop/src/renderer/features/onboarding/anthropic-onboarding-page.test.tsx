// @vitest-environment jsdom
/**
 * "Skip for now" on the Claude connect screen lets a user enter the app without
 * resolving a subscription token (they'll use the native claude CLI). It flips
 * the onboarding-completed atom, and cancels any in-flight auth subprocess.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, screen, fireEvent } from '@testing-library/react';
import { createTestStore, renderWithProviders } from '../../../../test-utils';
import { anthropicOnboardingCompletedAtom, billingMethodAtom } from '../../lib/atoms';
import { AnthropicOnboardingPage } from './anthropic-onboarding-page';

const mockState = vi.hoisted(() => ({
  systemToken: null as string | null,
  cancelMutate: vi.fn(),
  startMutateAsync: vi.fn(async () => ({ sessionId: 'sess-1' }))
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    claudeCode: {
      startAuth: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: mockState.startMutateAsync }) },
      cancelAuth: { useMutation: () => ({ mutate: mockState.cancelMutate, mutateAsync: vi.fn() }) },
      importSystemToken: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }) },
      getSystemToken: { useQuery: () => ({ data: { token: mockState.systemToken }, isLoading: false }) },
      getSystemCredentials: { useQuery: () => ({ data: undefined, isFetched: true }) },
      pollStatus: { useQuery: () => ({ data: undefined }) }
    }
  }
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mockState.systemToken = null;
  mockState.startMutateAsync.mockResolvedValue({ sessionId: 'sess-1' });
});

describe('AnthropicOnboardingPage — Skip for now', () => {
  it('flips the onboarding-completed atom and does not cancel when idle', () => {
    // An existing system token keeps the page idle (no auto-start), so skip
    // runs without a connecting subprocess to cancel.
    mockState.systemToken = 'tok-existing';
    const store = createTestStore();
    store.set(billingMethodAtom, 'claude-subscription');

    renderWithProviders(<AnthropicOnboardingPage />, { store });

    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));

    expect(store.get(anthropicOnboardingCompletedAtom)).toBe(true);
    expect(mockState.cancelMutate).not.toHaveBeenCalled();
  });

  it('cancels the in-flight auth session and completes when connecting', async () => {
    // No existing token → the page auto-starts auth and enters the connecting state.
    mockState.systemToken = null;
    const store = createTestStore();
    store.set(billingMethodAtom, 'claude-subscription');

    renderWithProviders(<AnthropicOnboardingPage />, { store });

    // Wait for the auto-start to resolve into the connecting state.
    await screen.findByText(/Connecting to Claude Code/i);

    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));

    expect(mockState.cancelMutate).toHaveBeenCalledWith({ sessionId: 'sess-1' });
    expect(store.get(anthropicOnboardingCompletedAtom)).toBe(true);
  });
});
