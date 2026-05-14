// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, screen, fireEvent } from '@testing-library/react';
import { createTestStore, renderWithProviders } from '../../../../test-utils';
import { NewProjectDialog } from './new-project-dialog';
import { newProjectDialogOpenAtom, newProjectActiveSectionAtom } from './atoms';
import { useSetAtom } from 'jotai';

afterEach(cleanup);

// Stub heavy sub-components so this test stays lightweight
vi.mock('./create-project-wizard', () => ({
  CreateProjectWizard: () => <div data-testid="create-wizard">Create wizard</div>
}));
vi.mock('./open-folder-section', () => ({
  OpenFolderSection: () => <div data-testid="open-section">Open folder</div>
}));
vi.mock('./clone-repo-section', () => ({
  CloneRepoSection: () => <div data-testid="clone-section">Clone repo</div>
}));

function DialogOpener() {
  const setOpen = useSetAtom(newProjectDialogOpenAtom);
  return <button onClick={() => setOpen(true)}>Open dialog</button>;
}

function setup(initialSection: 'create' | 'open' | 'clone' = 'create') {
  const store = createTestStore();
  store.set(newProjectDialogOpenAtom, true);
  store.set(newProjectActiveSectionAtom, initialSection);
  renderWithProviders(<NewProjectDialog />, { store });
  return store;
}

describe('NewProjectDialog', () => {
  it('shows "Add project" title when open', () => {
    setup();
    expect(screen.getByText('Add project')).toBeTruthy();
  });

  it('renders all three section tabs', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clone' })).toBeTruthy();
  });

  it('shows Create section by default', () => {
    setup('create');
    expect(screen.getByTestId('create-wizard')).toBeTruthy();
    expect(screen.queryByTestId('open-section')).toBeNull();
    expect(screen.queryByTestId('clone-section')).toBeNull();
  });

  it('switches to Open section when tab is clicked', () => {
    setup('create');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByTestId('open-section')).toBeTruthy();
    expect(screen.queryByTestId('create-wizard')).toBeNull();
  });

  it('switches to Clone section when tab is clicked', () => {
    setup('create');
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }));
    expect(screen.getByTestId('clone-section')).toBeTruthy();
    expect(screen.queryByTestId('create-wizard')).toBeNull();
  });

  it('switching tabs does not lose the dialog title', () => {
    setup('create');
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }));
    expect(screen.getByText('Add project')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText('Add project')).toBeTruthy();
  });

  it('dialog does not render when atom is false', () => {
    const store = createTestStore();
    store.set(newProjectDialogOpenAtom, false);
    renderWithProviders(<NewProjectDialog />, { store });
    expect(screen.queryByText('Add project')).toBeNull();
  });

  it('opening dialog via atom shows Create section', () => {
    const store = createTestStore();
    store.set(newProjectDialogOpenAtom, false);
    store.set(newProjectActiveSectionAtom, 'create');
    renderWithProviders(
      <>
        <NewProjectDialog />
        <DialogOpener />
      </>,
      { store }
    );
    fireEvent.click(screen.getByText('Open dialog'));
    expect(screen.getByTestId('create-wizard')).toBeTruthy();
  });
});
