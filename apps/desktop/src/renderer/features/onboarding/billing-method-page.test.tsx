// @vitest-environment jsdom
/**
 * Welcome screen wires the shared CLI detector to the selected provider tab:
 * Claude tab → claude install command; Codex tab → codex install command.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { cleanup, screen, fireEvent } from '@testing-library/react';
import { createTestStore, renderWithProviders } from '../../../../test-utils';
import { BillingMethodPage } from './billing-method-page';

afterEach(cleanup);

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      newProject: { detectCli: { invalidate: vi.fn(), fetch: vi.fn(), setData: vi.fn() } }
    })),
    newProject: {
      detectCli: {
        // Always "not installed" so the install command (which is derived from
        // the provider prop, not the data) is visible for assertion.
        useQuery: () => ({ data: { available: false, meetsMinimum: false }, isFetching: false })
      }
    }
  }
}));

vi.mock('@/lib/utils/platform', () => ({ getPlatform: () => 'darwin' }));

beforeEach(() => vi.clearAllMocks());

describe('BillingMethodPage — CLI detection', () => {
  it('shows the claude install command on the Claude tab and codex on the Codex tab', () => {
    renderWithProviders(<BillingMethodPage />, { store: createTestStore() });

    // Claude is the default selected group.
    expect(screen.getByText('curl -fsSL https://claude.ai/install.sh | bash')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
    expect(screen.getByText('brew install codex')).toBeTruthy();
  });
});
