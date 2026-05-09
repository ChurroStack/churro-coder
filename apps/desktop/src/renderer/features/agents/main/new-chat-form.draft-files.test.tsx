// @vitest-environment jsdom

// vi.hoisted ensures saveDraftSpy is available inside the hoisted vi.mock factory
const { saveDraftSpy } = vi.hoisted(() => ({
  saveDraftSpy: vi.fn().mockResolvedValue({ success: true })
}));

vi.mock('../lib/drafts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/drafts')>();
  return {
    ...real,
    saveNewChatDraftWithAttachments: saveDraftSpy
  };
});

// Stub useAgentsFileUpload so the component sees one pre-loaded attached file
vi.mock('../hooks/use-agents-file-upload', () => ({
  useAgentsFileUpload: () => ({
    images: [],
    files: [{ id: 'f1', filename: 'report.pdf', url: 'blob:fake-1', isLoading: false }],
    handleAddAttachments: vi.fn(),
    removeImage: vi.fn(),
    removeFile: vi.fn(),
    clearImages: vi.fn(),
    clearFiles: vi.fn(),
    isUploading: false,
    setImagesFromDraft: vi.fn(),
    setFilesFromDraft: vi.fn()
  })
}));

// Stub usePastedTextFiles so the component sees one pre-loaded pasted-text file
vi.mock('../hooks/use-pasted-text-files', () => ({
  usePastedTextFiles: () => ({
    pastedTexts: [
      {
        id: 'pasted_1',
        filePath: '/tmp/fake-session/pasted/pasted_1.txt',
        filename: 'pasted_1.txt',
        size: 12345,
        preview: 'Lorem ipsum dolor sit amet, consectetur',
        createdAt: new Date('2026-05-09T12:00:00.000Z')
      }
    ],
    addPastedText: vi.fn(async () => undefined),
    addChatHistoryFile: vi.fn(),
    removePastedText: vi.fn(),
    clearPastedTexts: vi.fn(),
    pastedTextsRef: { current: [] },
    setPastedTextsFromDraft: vi.fn()
  })
}));

// Shared trpc stub (same shape as new-chat-form.test.tsx)
const mocks = vi.hoisted(() => ({
  projectsListQuery: vi.fn()
}));

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
            mutate: vi.fn(),
            mutateAsync: vi.fn(async () => ({ id: 'new-chat-1' })),
            isPending: false
          }))
        }
      },
      openspec: {
        listChanges: { useQuery: vi.fn(() => ({ data: [], isLoading: false, isError: false })) },
        openSubChatForChange: {
          useMutation: vi.fn(() => ({
            mutate: vi.fn(),
            mutateAsync: vi.fn(async () => ({ id: 'sc-1', name: 'Spec', mode: 'plan' })),
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

afterEach(cleanup);

const mockProject = { id: 'p1', name: 'Test Project', path: '/test/project' };

beforeEach(() => {
  localStorage.clear();
  saveDraftSpy.mockClear();
  mocks.projectsListQuery.mockReturnValue({ data: [mockProject], isLoading: false, isError: false });
});

function renderWithProject() {
  const store = createTestStore();
  store.set(selectedProjectAtom, mockProject);
  return renderWithProviders(
    <TooltipProvider>
      <NewChatForm />
    </TooltipProvider>,
    { store }
  );
}

describe('NewChatForm — draft persists all attachment types', () => {
  it('saves files alongside images when text changes', async () => {
    const { container } = renderWithProject();

    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement | null;
    expect(editor).not.toBeNull();

    await act(async () => {
      editor!.textContent = 'Draft with a file attached';
      fireEvent.input(editor!);
    });

    // saveDraftSpy must have been called at least once
    expect(saveDraftSpy).toHaveBeenCalled();

    // Every call must forward the files array — not just images
    for (const call of saveDraftSpy.mock.calls) {
      const options = call[3] as { images?: unknown[]; files?: unknown[] } | undefined;
      expect(options).toEqual(
        expect.objectContaining({
          files: expect.arrayContaining([expect.objectContaining({ filename: 'report.pdf' })])
        })
      );
    }
  });

  it('saves pasted texts when text changes', async () => {
    const { container } = renderWithProject();

    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement | null;
    expect(editor).not.toBeNull();

    await act(async () => {
      editor!.textContent = 'Draft with a pasted text attachment';
      fireEvent.input(editor!);
    });

    expect(saveDraftSpy).toHaveBeenCalled();

    for (const call of saveDraftSpy.mock.calls) {
      const options = call[3] as { pastedTexts?: unknown[] } | undefined;
      expect(options).toEqual(
        expect.objectContaining({
          pastedTexts: expect.arrayContaining([expect.objectContaining({ filename: 'pasted_1.txt' })])
        })
      );
    }
  });
});
