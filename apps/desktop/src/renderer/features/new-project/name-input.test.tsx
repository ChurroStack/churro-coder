// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { cleanup, screen, fireEvent, act } from '@testing-library/react';
import { createTestStore, renderWithProviders } from '../../../../test-utils';
import { NameInput } from './name-input';
import { newProjectDraftAtom } from './atoms';

afterEach(cleanup);

// Control the useQuery response per test
const mockUseQuery = vi.fn(() => ({
  data: undefined as { valid: boolean; error?: string } | undefined,
  isLoading: false
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    newProject: {
      validateName: { useQuery: (...args: unknown[]) => (mockUseQuery as (...a: unknown[]) => unknown)(...args) }
    }
  }
}));

function setup(provider: 'github' | 'azure' | 'local' = 'github') {
  const store = createTestStore();
  store.set(newProjectDraftAtom, {
    ...store.get(newProjectDraftAtom),
    provider,
    accountId: 'user',
    name: ''
  });
  renderWithProviders(<NameInput />, { store });
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseQuery.mockReturnValue({ data: undefined, isLoading: false });
});

describe('NameInput', () => {
  it('renders a text input', () => {
    setup();
    expect(screen.getByPlaceholderText(/my-awesome-project/i)).toBeTruthy();
  });

  it('shows no error for empty name (no input yet)', () => {
    setup();
    expect(screen.queryByText(/Only letters/i)).toBeNull();
    expect(screen.queryByText(/required/i)).toBeNull();
  });

  it('shows inline error for invalid characters (GitHub)', () => {
    setup('github');
    const input = screen.getByPlaceholderText(/my-awesome-project/i);
    fireEvent.change(input, { target: { value: 'my repo' } });
    expect(screen.getByText(/Only letters/i)).toBeTruthy();
  });

  it('shows inline error for reserved name', () => {
    setup('github');
    const input = screen.getByPlaceholderText(/my-awesome-project/i);
    fireEvent.change(input, { target: { value: 'con' } });
    expect(screen.getByText(/reserved/i)).toBeTruthy();
  });

  it('shows inline error when name starts with a dot', () => {
    setup('github');
    const input = screen.getByPlaceholderText(/my-awesome-project/i);
    fireEvent.change(input, { target: { value: '.hidden' } });
    expect(screen.getByText(/dot/i)).toBeTruthy();
  });

  it('shows server error when server check returns invalid', () => {
    mockUseQuery.mockReturnValue({
      data: { valid: false, error: 'A project with that name already exists locally' },
      isLoading: false
    });
    setup('github');
    const input = screen.getByPlaceholderText(/my-awesome-project/i);
    fireEvent.change(input, { target: { value: 'valid-name' } });
    expect(screen.getByText(/already exists/i)).toBeTruthy();
  });

  it('shows no error for a valid github name', () => {
    mockUseQuery.mockReturnValue({ data: { valid: true }, isLoading: false });
    setup('github');
    const input = screen.getByPlaceholderText(/my-awesome-project/i);
    fireEvent.change(input, { target: { value: 'my-valid-repo' } });
    expect(screen.queryByText(/error|invalid|required|reserved|dot/i)).toBeNull();
  });

  it('allows spaces in azure provider names', () => {
    setup('azure');
    const input = screen.getByPlaceholderText(/my-awesome-project/i);
    fireEvent.change(input, { target: { value: 'My Azure Repo' } });
    expect(screen.queryByRole('alert')).toBeNull();
    // No error paragraph should appear for a valid azure name
    const errorEl = screen.queryByText(/Only letters|invalid char/i);
    expect(errorEl).toBeNull();
  });
});
