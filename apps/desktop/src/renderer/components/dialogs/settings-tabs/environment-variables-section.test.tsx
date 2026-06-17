// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvironmentVariablesSection } from './environment-variables-section';

// Mutable list returned by the mocked list query.
const listData = [
  { id: 'v1', key: 'FOO', value: 'bar', isProtected: false },
  { id: 'v2', key: 'SECRET', value: '••••••••', isProtected: true }
];

const setMutate = vi.fn((_input: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());
const removeMutate = vi.fn();
const revealFetch = vi.fn(async () => ({ value: 's3cr3t' }));
const listInvalidate = vi.fn();

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      projectEnv: {
        list: { invalidate: listInvalidate },
        reveal: { fetch: revealFetch }
      }
    }),
    projectEnv: {
      list: { useQuery: () => ({ data: listData }) },
      set: { useMutation: () => ({ mutate: setMutate }) },
      remove: { useMutation: () => ({ mutate: removeMutate }) }
    }
  }
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSection() {
  return render(<EnvironmentVariablesSection projectId="p1" />);
}

describe('EnvironmentVariablesSection [project-env]', () => {
  it('lists vars and masks protected values', () => {
    renderSection();
    expect(screen.getByLabelText('Variable FOO')).toBeTruthy();
    expect(screen.getByLabelText('Variable SECRET')).toBeTruthy();
    // Plaintext value is shown in its input; secret is not present anywhere.
    expect((screen.getByLabelText('Value of FOO') as HTMLInputElement).value).toBe('bar');
    expect(screen.queryByDisplayValue('s3cr3t')).toBeNull();
    expect(screen.getByText('••••••••')).toBeTruthy();
  });

  it('reveals a protected value on demand', async () => {
    renderSection();
    fireEvent.click(screen.getByLabelText('Reveal SECRET'));
    await waitFor(() => expect(revealFetch).toHaveBeenCalledWith({ projectId: 'p1', id: 'v2' }));
    await waitFor(() => expect((screen.getByLabelText('Value of SECRET') as HTMLInputElement).value).toBe('s3cr3t'));
  });

  it('adds a new variable', () => {
    renderSection();
    fireEvent.change(screen.getByLabelText('New variable name'), { target: { value: 'API_URL' } });
    fireEvent.change(screen.getByLabelText('New variable value'), { target: { value: 'https://x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(setMutate).toHaveBeenCalledWith(
      { projectId: 'p1', key: 'API_URL', value: 'https://x', isProtected: false },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('rejects an invalid key without calling set', () => {
    renderSection();
    fireEvent.change(screen.getByLabelText('New variable name'), { target: { value: '1BAD KEY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(setMutate).not.toHaveBeenCalled();
  });

  it('deletes a variable', () => {
    renderSection();
    fireEvent.click(screen.getByLabelText('Delete FOO'));
    expect(removeMutate).toHaveBeenCalledWith({ projectId: 'p1', id: 'v1' });
  });

  it('protects an unprotected var by encrypting its current value', () => {
    renderSection();
    fireEvent.click(screen.getByLabelText('Protect FOO'));
    expect(setMutate).toHaveBeenCalledWith({ projectId: 'p1', key: 'FOO', value: 'bar', isProtected: true });
  });

  it('unprotects a protected var by revealing then storing the plaintext', async () => {
    renderSection();
    fireEvent.click(screen.getByLabelText('Unprotect SECRET'));
    await waitFor(() => expect(revealFetch).toHaveBeenCalledWith({ projectId: 'p1', id: 'v2' }));
    await waitFor(() =>
      expect(setMutate).toHaveBeenCalledWith({ projectId: 'p1', key: 'SECRET', value: 's3cr3t', isProtected: false })
    );
  });

  it('saves an edited value on blur, and no-ops when unchanged', () => {
    renderSection();
    const input = screen.getByLabelText('Value of FOO') as HTMLInputElement;

    // Unchanged blur → no write.
    fireEvent.blur(input);
    expect(setMutate).not.toHaveBeenCalled();

    // Edited blur → persisted.
    fireEvent.change(input, { target: { value: 'baz' } });
    fireEvent.blur(input);
    expect(setMutate).toHaveBeenCalledWith({ projectId: 'p1', key: 'FOO', value: 'baz', isProtected: false });
  });
});
