// @vitest-environment jsdom

// vi.hoisted exposes these refs inside the vi.mock factory (which is also hoisted)
const mocks = vi.hoisted(() => ({
  createChatMutate: vi.fn(),
  createChatMutateAsync: vi.fn(async () => ({ id: 'new-chat-1' })),
  openspecQuery: vi.fn(),
  projectsListQuery: vi.fn(),
  openSubChatForChangeMutateAsync: vi.fn(async () => ({ id: 'sc-1', name: 'Spec', mode: 'plan' }))
}));

// Stub the file-viewer component that transitively imports monaco-editor,
// which breaks in jsdom (calls document.queryCommandSupported).
vi.mock('./new-workspace-explorer', () => ({ NewWorkspaceExplorer: () => null }));

vi.mock('../../../lib/trpc', () => {
  const q = (data: unknown = undefined) => vi.fn(() => ({ data, isLoading: false, isError: false, refetch: vi.fn() }));
  const m = () => vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => undefined), isPending: false }));
  const utils = {
    chats: { list: { invalidate: vi.fn() } },
    projects: { list: { setData: vi.fn() } },
    commands: {
      list: { fetch: vi.fn(async () => []) },
      getContent: { fetch: vi.fn(async () => ({ content: '' })) }
    },
    files: { readFile: { fetch: vi.fn(async () => '') } }
  };
  return {
    trpc: {
      projects: {
        list: { useQuery: mocks.projectsListQuery },
        openFolder: { useMutation: m() },
        cloneFromGitHub: { useMutation: m() }
      },
      chats: {
        list: { useQuery: q([]) },
        create: {
          useMutation: vi.fn(() => ({
            mutate: mocks.createChatMutate,
            mutateAsync: mocks.createChatMutateAsync,
            isPending: false
          }))
        }
      },
      openspec: {
        listChanges: { useQuery: mocks.openspecQuery },
        openSubChatForChange: {
          useMutation: vi.fn(() => ({
            mutate: vi.fn(),
            mutateAsync: mocks.openSubChatForChangeMutateAsync,
            isPending: false
          }))
        }
      },
      ollama: { getStatus: { useQuery: q(null) } },
      voice: {
        transcribe: { useMutation: m() },
        isAvailable: { useQuery: q({ available: false }) }
      },
      claudeCode: { getIntegration: { useQuery: q(null) } },
      changes: {
        getBranches: { useQuery: q(null) },
        fetchRemote: { useMutation: m() },
        createBranch: { useMutation: m() }
      },
      worktreeConfig: { get: { useQuery: q(null) } },
      files: { writePastedText: { useMutation: m() }, search: { useQuery: q([]) } },
      skills: { listEnabled: { useQuery: q([]) } },
      agents: { listEnabled: { useQuery: q([]) } },
      commands: { list: { useQuery: q([]) } },
      useUtils: vi.fn(() => utils)
    },
    trpcClient: {}
  };
});

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, fireEvent } from '@testing-library/react';
import { createTestStore, renderWithProviders } from '../../../../../test-utils';
import { selectedProjectAtom } from '../atoms';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { NewChatForm } from './new-chat-form';
import type { ChangeSummary } from '../../../../main/lib/openspec/types';

afterEach(cleanup);

const mockProject = { id: 'p1', name: 'Test Project', path: '/test/project' };

function makeChange(id: string): ChangeSummary {
  return {
    changeId: id,
    modifiedAt: new Date().toISOString(),
    proposal: { title: `Spec ${id}`, why: `Because ${id}`, tasks: [], attributes: {} }
  };
}

beforeEach(() => {
  localStorage.clear();
  mocks.createChatMutate.mockClear();
  mocks.createChatMutateAsync.mockClear();
  mocks.openSubChatForChangeMutateAsync.mockClear();
  // Default: no project in projects list
  mocks.projectsListQuery.mockReturnValue({ data: [], isLoading: false, isError: false });
  // Default: no openspec changes
  mocks.openspecQuery.mockReturnValue({ data: [], isLoading: false, isError: false });
});

function renderNoProject() {
  return renderWithProviders(
    <TooltipProvider>
      <NewChatForm />
    </TooltipProvider>
  );
}

function renderWithProject(changes: ChangeSummary[] = []) {
  // Include mockProject in the list so validatedProject resolves correctly
  mocks.projectsListQuery.mockReturnValue({ data: [mockProject], isLoading: false, isError: false });
  if (changes.length > 0) {
    mocks.openspecQuery.mockReturnValue({ data: changes, isLoading: false, isError: false });
  }
  const store = createTestStore();
  store.set(selectedProjectAtom, mockProject);
  return renderWithProviders(
    <TooltipProvider>
      <NewChatForm />
    </TooltipProvider>,
    { store }
  );
}

describe('NewChatForm — no project', () => {
  it('shows Select repo button when no project is selected', () => {
    const { getByText, queryByText } = renderNoProject();
    expect(getByText('Select repo')).toBeTruthy();
    // Wizard sections should NOT render
    expect(queryByText('New workspace')).toBeTruthy(); // hero always shows
    expect(queryByText('Agent mode')).toBeNull(); // wizard sections hidden
  });
});

describe('NewChatForm — with project', () => {
  it('renders hero and wizard sections when a project is selected', () => {
    const { getByText } = renderWithProject();
    expect(getByText('New workspace')).toBeTruthy();
    expect(getByText('Agent mode')).toBeTruthy();
    expect(getByText('Type of work')).toBeTruthy();
  });

  it('send button is enabled when no spec is selected (open path)', () => {
    const { container } = renderWithProject();
    const btn = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(false);
  });

  it('send button is enabled when a spec is selected but prompt is blank (view-only open)', async () => {
    const change = makeChange('c1');
    const { container, getByText } = renderWithProject([change]);

    // Click the spec card to select the spec
    await act(async () => {
      fireEvent.click(getByText('Spec c1'));
    });

    const btn = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(false);
  });

  it('send button is enabled when a spec is selected and text is present', async () => {
    const change = makeChange('c2');
    const { container, getByText } = renderWithProject([change]);

    // Select the spec
    await act(async () => {
      fireEvent.click(getByText('Spec c2'));
    });

    // Type into the editor
    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement | null;
    expect(editor).not.toBeNull();
    await act(async () => {
      editor!.textContent = 'Implement the feature';
      fireEvent.input(editor!);
    });

    const btn = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
    expect(btn?.disabled).toBe(false);
  });

  it('clicking send with a blank prompt calls mutate with empty initialMessageParts', async () => {
    const { container } = renderWithProject();
    const btn = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();

    await act(async () => {
      fireEvent.click(btn!);
    });

    expect(mocks.createChatMutate).toHaveBeenCalledOnce();
    expect(mocks.createChatMutate).toHaveBeenCalledWith(
      expect.objectContaining({ initialMessageParts: [] }),
      expect.anything()
    );
  });

  it('clicking a spec card opens the OpenSpec sub-chat exactly once', async () => {
    const change = makeChange('c5');
    const { getByText } = renderWithProject([change]);

    await act(async () => {
      fireEvent.click(getByText('Spec c5'));
    });

    expect(mocks.openSubChatForChangeMutateAsync).toHaveBeenCalledTimes(1);
    expect(mocks.openSubChatForChangeMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ changeId: 'c5' }));
  });

  it('clicking a spec card twice (toggle deselect) does NOT call openSubChatForChange the second time', async () => {
    const change = makeChange('c6');
    const { getAllByText } = renderWithProject([change]);

    // First click on the spec card (always the first occurrence in the picker)
    await act(async () => {
      fireEvent.click(getAllByText('Spec c6')[0]!);
    });
    expect(mocks.openSubChatForChangeMutateAsync).toHaveBeenCalledTimes(1);

    // Second click: deselect → must be a no-op (no extra mutate call, no
    // duplicate workspace creation)
    await act(async () => {
      fireEvent.click(getAllByText('Spec c6')[0]!);
    });
    expect(mocks.openSubChatForChangeMutateAsync).toHaveBeenCalledTimes(1);
  });

  it('clicking send after typing text calls mutate with a text message part', async () => {
    const { container } = renderWithProject();

    // Type into the editor
    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement | null;
    expect(editor).not.toBeNull();
    await act(async () => {
      editor!.textContent = 'Build the dashboard feature';
      fireEvent.input(editor!);
    });

    const btn = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
    await act(async () => {
      fireEvent.click(btn!);
    });

    expect(mocks.createChatMutate).toHaveBeenCalledOnce();
    expect(mocks.createChatMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        initialMessageParts: [{ type: 'text', text: 'Build the dashboard feature' }]
      }),
      expect.anything()
    );
  });
});
