// @vitest-environment jsdom
import { fireEvent, screen, cleanup, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../test-utils';
import { AgentsPreferencesTab } from './agents-preferences-tab';

// The tab only touches trpc for the Co-Authored-By setting; stub that surface.
vi.mock('../../../lib/trpc', () => ({
  trpc: {
    claudeSettings: {
      getIncludeCoAuthoredBy: { useQuery: () => ({ data: true, refetch: vi.fn() }) },
      setIncludeCoAuthoredBy: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) }
    }
  }
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Requirement: Default Advisor mode row [agents-preferences/advisor]
describe('Default Advisor mode [agents-preferences/advisor]', () => {
  it('renders a Default Advisor row with an opt-in switch, off by default', () => {
    renderWithProviders(<AgentsPreferencesTab />);
    expect(screen.getByText('Default Advisor')).toBeTruthy();
    const advisorSwitch = screen.getByRole('switch', { name: 'Enable Default Advisor mode' });
    expect(advisorSwitch.getAttribute('aria-checked')).toBe('false');
  });

  it('disables the advisor model selector until the switch is on', () => {
    renderWithProviders(<AgentsPreferencesTab />);
    const modelSelect = screen.getByRole('combobox', { name: 'Advisor model' });
    expect((modelSelect as HTMLButtonElement).disabled).toBe(true);
    // Default advisor model is Fable (the highest-tier advisor).
    expect(within(modelSelect).getByText('fable')).toBeTruthy();

    fireEvent.click(screen.getByRole('switch', { name: 'Enable Default Advisor mode' }));

    expect(screen.getByRole('switch', { name: 'Enable Default Advisor mode' }).getAttribute('aria-checked')).toBe(
      'true'
    );
    expect((screen.getByRole('combobox', { name: 'Advisor model' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
