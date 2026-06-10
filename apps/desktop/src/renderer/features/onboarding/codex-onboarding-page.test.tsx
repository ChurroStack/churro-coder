// @vitest-environment jsdom
/**
 * "Skip for now" on the Codex connect screen lets a user enter the app without
 * resolving a subscription token (they'll use the native codex CLI). It flips
 * the onboarding-completed atom, and cancels any in-flight login when running.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { createTestStore, renderWithProviders } from '../../../../test-utils';
import { billingMethodAtom, codexOnboardingCompletedAtom } from '../../lib/atoms';
import { CodexOnboardingPage } from './codex-onboarding-page';

const flow = vi.hoisted(() => ({
  state: 'idle' as string,
  method: 'chatgpt' as 'chatgpt' | 'api_key',
  isRunning: false,
  cancel: vi.fn(async () => {}),
  start: vi.fn(async () => {})
}));

vi.mock('../agents/hooks/use-codex-login-flow', () => ({
  useCodexLoginFlow: () => ({
    state: flow.state,
    method: flow.method,
    apiKeyInput: '',
    url: null,
    error: null,
    isRunning: flow.isRunning,
    isOpeningUrl: false,
    start: flow.start,
    saveApiKey: vi.fn(),
    setMethod: vi.fn(),
    setApiKeyInput: vi.fn(),
    cancel: flow.cancel,
    openUrl: vi.fn()
  })
}));

// Stub the heavy login content; the skip button lives in the page, not here.
vi.mock('../agents/components/codex-login-content', () => ({
  CodexLoginContent: () => null
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  flow.state = 'idle';
  flow.method = 'chatgpt';
  flow.isRunning = false;
});

describe('CodexOnboardingPage — Skip for now', () => {
  it('flips the onboarding-completed atom and does not cancel when idle', () => {
    flow.isRunning = false;
    const store = createTestStore();
    store.set(billingMethodAtom, 'codex-subscription');

    renderWithProviders(<CodexOnboardingPage />, { store });

    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));

    expect(store.get(codexOnboardingCompletedAtom)).toBe(true);
    expect(flow.cancel).not.toHaveBeenCalled();
  });

  it('cancels the in-flight login and completes when running', async () => {
    flow.isRunning = true;
    const store = createTestStore();
    store.set(billingMethodAtom, 'codex-subscription');

    renderWithProviders(<CodexOnboardingPage />, { store });

    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));

    await waitFor(() => expect(flow.cancel).toHaveBeenCalled());
    expect(store.get(codexOnboardingCompletedAtom)).toBe(true);
  });
});
