// @vitest-environment jsdom

// vi.hoisted exposes these refs inside the vi.mock factory (which is also hoisted)
const mocks = vi.hoisted(() => ({
  createChatMutate: vi.fn(),
  createChatMutateAsync: vi.fn(async () => ({ id: 'new-chat-1' })),
  openspecQuery: vi.fn(),
  projectsListQuery: vi.fn(),
  supportsWorktreeQuery: vi.fn(),
  openspecInitMutateAsync: vi.fn(async () => ({
    targetRoot: '/test/project',
    tools: ['claude', 'codex'],
    alreadyInitialized: false
  })),
  createOpenSpecChangeMutateAsync: vi.fn(async () => ({ ok: true })),
  openSubChatForChangeMutateAsync: vi.fn(async () => ({ id: 'sc-1', name: 'Spec', mode: 'execute' }))
}));

// Stub the file-viewer component that transitively imports monaco-editor,
// which breaks in jsdom (calls document.queryCommandSupported).
vi.mock('./new-workspace-explorer', () => ({ NewWorkspaceExplorer: () => null }));

vi.mock('../../../lib/trpc', () => {
  const q = (data: unknown = undefined) => vi.fn(() => ({ data, isLoading: false, isError: false, refetch: vi.fn() }));
  const m = () => vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => undefined), isPending: false }));
  const utils = {
    chats: { list: { invalidate: vi.fn(), fetch: vi.fn(async () => []) } },
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
        supportsWorktree: { useQuery: mocks.supportsWorktreeQuery },
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
        },
        openspecInit: {
          useMutation: vi.fn(() => ({
            mutate: vi.fn(),
            mutateAsync: mocks.openspecInitMutateAsync,
            isPending: false
          }))
        },
        openspecStateByProject: { useQuery: q({ initialized: true, missingTools: [] }) }
      },
      openspec: {
        listChanges: { useQuery: mocks.openspecQuery },
        createChange: {
          useMutation: vi.fn(() => ({
            mutate: vi.fn(),
            mutateAsync: mocks.createOpenSpecChangeMutateAsync,
            isPending: false
          }))
        },
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
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { createTestStore, renderWithProviders } from '../../../../../test-utils';
import { lastSelectedAgentHarnessAtom, lastSelectedHarnessAtom, selectedProjectAtom } from '../atoms';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { NewChatForm } from './new-chat-form';
import type { ChangeSummary } from '../../../../main/lib/openspec/types';
import { appStore } from '../../../lib/jotai-store';
import { pendingOpenSpecMessageAtom } from '../../openspec/atoms';

afterEach(cleanup);

const mockProject = { id: 'p1', name: 'Test Project', path: '/test/project' };

function makeChange(id: string): ChangeSummary {
  return {
    changeId: id,
    path: `/test/project/openspec/changes/${id}`,
    hasProposal: true,
    hasTasks: false,
    hasDesign: false,
    capabilities: [],
    modifiedAt: new Date().toISOString(),
    proposal: { changeId: id, title: `Spec ${id}`, why: `Because ${id}`, whatChanges: [], attributes: {} }
  };
}

beforeEach(() => {
  localStorage.clear();
  mocks.createChatMutate.mockClear();
  mocks.createChatMutateAsync.mockClear();
  mocks.openspecInitMutateAsync.mockClear();
  mocks.createOpenSpecChangeMutateAsync.mockClear();
  mocks.openSubChatForChangeMutateAsync.mockClear();
  appStore.set(pendingOpenSpecMessageAtom, null);
  // Default: no project in projects list
  mocks.projectsListQuery.mockReturnValue({ data: [], isLoading: false, isError: false });
  // Default: no openspec changes
  mocks.openspecQuery.mockReturnValue({ data: [], isLoading: false, isError: false });
  // Default: project supports worktrees (Send enabled)
  mocks.supportsWorktreeQuery.mockReturnValue({ data: { supported: true }, isLoading: false, isError: false });
});

function renderNoProject() {
  return renderWithProviders(
    <TooltipProvider>
      <NewChatForm />
    </TooltipProvider>
  );
}

function renderWithProject(
  changes: ChangeSummary[] = [],
  opts: { harness?: 'builtin' | 'claude-cli' | 'codex-cli'; specDriven?: boolean } = {}
) {
  // Include mockProject in the list so validatedProject resolves correctly
  mocks.projectsListQuery.mockReturnValue({ data: [mockProject], isLoading: false, isError: false });
  if (changes.length > 0) {
    mocks.openspecQuery.mockReturnValue({ data: changes, isLoading: false, isError: false });
  }
  const store = createTestStore();
  store.set(selectedProjectAtom, mockProject);
  // Workflow-mode / harness tests pin state via atoms instead of driving the
  // Radix Popover open — that path is flaky in jsdom under CI cold start (the
  // first popover open can exceed every reasonable findBy* poll window). The
  // dropdowns are just setters for these atoms; the integration we care about
  // is the value that reaches the create-chat mutation and the derived UI.
  //  - opts.harness    → lastSelectedAgentHarnessAtom (builtin/claude-cli/codex-cli)
  //  - opts.specDriven → lastSelectedHarnessAtom='spec-driven' (the 4th workflow mode)
  if (opts.harness) {
    store.set(lastSelectedAgentHarnessAtom, opts.harness);
  }
  if (opts.specDriven) {
    store.set(lastSelectedHarnessAtom, 'spec-driven');
  }
  return renderWithProviders(
    <TooltipProvider>
      <NewChatForm />
    </TooltipProvider>,
    { store }
  );
}

describe('NewChatForm — no project', () => {
  it('shows Select repo button when no project is selected', () => {
    const { getByText, queryByText, queryByTestId } = renderNoProject();
    expect(getByText('Select repo')).toBeTruthy();
    expect(queryByText('New workspace')).toBeTruthy(); // hero always shows
    // The input + its dropdowns only render once a project is selected
    expect(queryByTestId('agent-mode-dropdown')).toBeNull();
  });
});

describe('NewChatForm — simplified workspace UI', () => {
  it('renders only the hero + input dropdowns; no numbered Step 1/Step 2 sections', () => {
    const { getByText, queryByText, getByTestId } = renderWithProject();
    expect(getByText('New workspace')).toBeTruthy();
    // The in-input workflow-mode + harness dropdowns are present...
    expect(getByTestId('agent-mode-dropdown')).toBeTruthy();
    expect(getByTestId('agent-harness-dropdown')).toBeTruthy();
    // ...and the old numbered wizard step headings are gone.
    expect(queryByText('Agent mode')).toBeNull();
    expect(queryByText('Harness')).toBeNull();
    expect(queryByText('Type of work')).toBeNull();
  });

  it('mode dropdown trigger reflects workflow mode: defaults to Plan, shows Spec-driven when active', () => {
    // Default agent mode is 'plan'
    const { getByTestId, unmount } = renderWithProject();
    expect(getByTestId('agent-mode-dropdown').textContent).toContain('Plan');
    unmount();
    // Spec-driven pinned via the OpenSpec harness atom
    const spec = renderWithProject([], { specDriven: true });
    expect(spec.getByTestId('agent-mode-dropdown').textContent).toContain('Spec-driven');
  });

  // The workflow-mode reconciliation that the dropdown drives — concrete modes
  // resetting the harness and abandoning a selected spec (E1/E4), spec-driven
  // preserving it (E2) — is unit-tested as the pure `nextWorkflowSelection`
  // helper in lib/wizard-state.test.ts. We don't drive the Radix popover open
  // here: that path is flaky in jsdom under CI cold start (see the note on
  // renderWithProject), so the dropdown's selection logic is verified at the
  // pure-function layer instead.

  it('model selector is shown for builtin and hidden for CLI harnesses', () => {
    const builtin = renderWithProject();
    expect(builtin.queryByTestId('model-selector-slot')).toBeTruthy();
    builtin.unmount();

    const claude = renderWithProject([], { harness: 'claude-cli' });
    expect(claude.queryByTestId('model-selector-slot')).toBeNull();
    claude.unmount();

    const codex = renderWithProject([], { harness: 'codex-cli' });
    expect(codex.queryByTestId('model-selector-slot')).toBeNull();
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

  it('submitting spec-driven without an existing change initializes OpenSpec, opens a change, and queues propose', async () => {
    const { container } = renderWithProject([], { specDriven: true });

    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement | null;
    expect(editor).not.toBeNull();
    await act(async () => {
      editor!.textContent = 'Build the payment flow';
      fireEvent.input(editor!);
    });

    const btn = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
    await act(async () => {
      fireEvent.click(btn!);
    });

    expect(mocks.createChatMutate).not.toHaveBeenCalled();
    expect(mocks.createChatMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ initialMessageParts: [], mode: 'execute' })
    );
    expect(mocks.openspecInitMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'new-chat-1' }));
    expect(mocks.createOpenSpecChangeMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'new-chat-1', changeId: 'add-build-the-payment-flow' })
    );
    expect(mocks.openSubChatForChangeMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'new-chat-1', changeId: 'add-build-the-payment-flow' })
    );
    expect(appStore.get(pendingOpenSpecMessageAtom)).toEqual(
      expect.objectContaining({
        subChatId: 'sc-1',
        message: expect.stringContaining('Build the payment flow')
      })
    );
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

// Task 8.6 — wizard 2×3 combination matrix:
// card ∈ {vibe-coding, spec-driven} × agent ∈ {builtin, claude-cli, codex-cli}
// Each cell verifies the axes are independent (card value and agent harness don't bleed into each other).
describe('NewChatForm — wizard axis independence', () => {
  it('vibe-coding + builtin: sends with harness=builtin (regression baseline)', async () => {
    const { container } = renderWithProject();

    const btn = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
    await act(async () => {
      fireEvent.click(btn!);
    });

    expect(mocks.createChatMutate).toHaveBeenCalledWith(
      expect.objectContaining({ harness: 'builtin' }),
      expect.anything()
    );
  });

  it('vibe-coding + claude-cli: sends with harness=claude-cli', async () => {
    const { container } = renderWithProject([], { harness: 'claude-cli' });

    const btn = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
    await act(async () => {
      fireEvent.click(btn!);
    });

    expect(mocks.createChatMutate).toHaveBeenCalledWith(
      expect.objectContaining({ harness: 'claude-cli' }),
      expect.anything()
    );
  });

  it('vibe-coding + codex-cli: sends with harness=codex-cli', async () => {
    const { container } = renderWithProject([], { harness: 'codex-cli' });

    const btn = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
    await act(async () => {
      fireEvent.click(btn!);
    });

    expect(mocks.createChatMutate).toHaveBeenCalledWith(
      expect.objectContaining({ harness: 'codex-cli' }),
      expect.anything()
    );
  });

  it('spec-driven + builtin: createAsync called with harness=builtin and mode=execute', async () => {
    const { container } = renderWithProject([], { specDriven: true });

    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement | null;
    await act(async () => {
      editor!.textContent = 'Add spec feature';
      fireEvent.input(editor!);
    });

    const btn = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
    await act(async () => {
      fireEvent.click(btn!);
    });

    expect(mocks.createChatMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ harness: 'builtin', mode: 'execute' })
    );
  });

  it('spec-driven + claude-cli: createAsync called with harness=claude-cli', async () => {
    const { container } = renderWithProject([], { harness: 'claude-cli', specDriven: true });

    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement | null;
    await act(async () => {
      editor!.textContent = 'Add spec feature';
      fireEvent.input(editor!);
    });

    const btn = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
    await act(async () => {
      fireEvent.click(btn!);
    });

    expect(mocks.createChatMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ harness: 'claude-cli', mode: 'execute' })
    );
  });

  it('spec-driven + codex-cli: createAsync called with harness=codex-cli', async () => {
    const { container } = renderWithProject([], { harness: 'codex-cli', specDriven: true });

    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement | null;
    await act(async () => {
      editor!.textContent = 'Add spec feature';
      fireEvent.input(editor!);
    });

    const btn = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
    await act(async () => {
      fireEvent.click(btn!);
    });

    expect(mocks.createChatMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ harness: 'codex-cli', mode: 'execute' })
    );
  });
});

// New Workspace is worktree-only: a non-git / commit-less folder can't create a
// worktree, so Send is disabled and a warning offers the Local workspace instead.
describe('NewChatForm — worktree git gate', () => {
  it('non-git folder disables Send and shows the Open local workspace warning', () => {
    mocks.supportsWorktreeQuery.mockReturnValue({
      data: { supported: false, reason: 'not-a-repo' },
      isLoading: false,
      isError: false
    });
    const { container, getByText, getByRole } = renderWithProject();

    const btn = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
    expect(btn?.disabled).toBe(true);
    expect(getByText(/not a git repository/i)).toBeTruthy();
    expect(getByRole('button', { name: /open local workspace/i })).toBeTruthy();
  });

  it('a repo with no commits shows the "make an initial commit" reason', () => {
    mocks.supportsWorktreeQuery.mockReturnValue({
      data: { supported: false, reason: 'no-commits' },
      isLoading: false,
      isError: false
    });
    const { container, getByText } = renderWithProject();

    const btn = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
    expect(btn?.disabled).toBe(true);
    expect(getByText(/make an initial commit/i)).toBeTruthy();
  });

  it('keeps Send enabled when the project supports worktrees', () => {
    const { container } = renderWithProject();
    const btn = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
    expect(btn?.disabled).toBe(false);
  });

  it('disables Send while the worktree gate is still loading (no fast-submit slip-through)', () => {
    mocks.supportsWorktreeQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = renderWithProject();
    const btn = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
    expect(btn?.disabled).toBe(true);
  });
});
