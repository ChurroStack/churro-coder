// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, screen, fireEvent } from '@testing-library/react';
import { createTestStore, renderWithProviders } from '../../../../test-utils';
import { VisibilityCheckbox } from './visibility-checkbox';
import { newProjectDraftAtom } from './atoms';
import { useAtomValue } from 'jotai';

afterEach(cleanup);

function DraftInspector() {
  const draft = useAtomValue(newProjectDraftAtom);
  return <div data-testid="visibility">{draft.visibility ?? 'undefined'}</div>;
}

describe('VisibilityCheckbox', () => {
  it('renders when provider is github', () => {
    const store = createTestStore();
    store.set(newProjectDraftAtom, { ...store.get(newProjectDraftAtom), provider: 'github' });
    renderWithProviders(<VisibilityCheckbox />, { store });
    expect(screen.getByLabelText(/public/i)).toBeTruthy();
  });

  it('is hidden when provider is azure', () => {
    const store = createTestStore();
    store.set(newProjectDraftAtom, { ...store.get(newProjectDraftAtom), provider: 'azure' });
    const { container } = renderWithProviders(<VisibilityCheckbox />, { store });
    expect(container.firstChild).toBeNull();
  });

  it('is hidden when provider is local', () => {
    const store = createTestStore();
    store.set(newProjectDraftAtom, { ...store.get(newProjectDraftAtom), provider: 'local' });
    const { container } = renderWithProviders(<VisibilityCheckbox />, { store });
    expect(container.firstChild).toBeNull();
  });

  it('sets visibility to public when checked', () => {
    const store = createTestStore();
    store.set(newProjectDraftAtom, { ...store.get(newProjectDraftAtom), provider: 'github', visibility: undefined });
    renderWithProviders(
      <>
        <VisibilityCheckbox />
        <DraftInspector />
      </>,
      { store }
    );
    const checkbox = screen.getByLabelText(/public/i);
    fireEvent.click(checkbox);
    expect(screen.getByTestId('visibility').textContent).toBe('public');
  });

  it('sets visibility to undefined when unchecked', () => {
    const store = createTestStore();
    store.set(newProjectDraftAtom, { ...store.get(newProjectDraftAtom), provider: 'github', visibility: 'public' });
    renderWithProviders(
      <>
        <VisibilityCheckbox />
        <DraftInspector />
      </>,
      { store }
    );
    const checkbox = screen.getByLabelText(/public/i);
    fireEvent.click(checkbox);
    expect(screen.getByTestId('visibility').textContent).toBe('undefined');
  });
});
