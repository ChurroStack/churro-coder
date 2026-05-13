// @vitest-environment jsdom
const mocks = vi.hoisted(() => {
  const writeFileMutateAsync = vi.fn(async () => ({ success: true }));
  const appendMessageMutateAsync = vi.fn(async () => 1);
  return {
    writeFileMutateAsync,
    appendMessageMutateAsync,
    invalidateReadTextFile: vi.fn(async () => undefined),
    invalidateGetLatest: vi.fn(async () => undefined),
    invalidateGetBefore: vi.fn(async () => undefined),
    invalidateGetAfter: vi.fn(async () => undefined),
    openInAppMutate: vi.fn(),
    editorUpdateOptions: vi.fn(),
    editorTrigger: vi.fn()
  };
});

vi.mock('@monaco-editor/react', () => {
  const React = require('react') as typeof import('react');
  return {
    __esModule: true,
    default: ({
      value,
      onChange,
      onMount
    }: {
      value: string;
      onChange?: (value: string) => void;
      onMount?: (editor: any, monaco: any) => void;
    }) => {
      React.useEffect(() => {
        if (!onMount) return;
        onMount(
          {
            updateOptions: mocks.editorUpdateOptions,
            getDomNode: () => document.createElement('div'),
            onDidChangeCursorSelection: () => ({ dispose: () => {} }),
            getSelection: () => null,
            getModel: () => ({ getValueInRange: () => '', getValue: () => value }),
            focus: vi.fn(),
            trigger: mocks.editorTrigger,
            revealLineInCenter: vi.fn(),
            setPosition: vi.fn()
          },
          { editor: { setTheme: vi.fn() } }
        );
      }, [onMount, value]);

      return <textarea aria-label="Monaco editor" value={value} onChange={(e) => onChange?.(e.target.value)} />;
    }
  };
});

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light' })
}));

vi.mock('@/lib/themes', () => ({
  useVSCodeTheme: () => ({ currentTheme: null })
}));

vi.mock('./monaco-config', () => ({
  getEditorOptions: (readOnly: boolean) => ({ readOnly }),
  getMonacoTheme: () => 'vs',
  registerMonacoTheme: () => 'vs'
}));

vi.mock('./markdown-viewer', () => ({
  MarkdownViewer: () => null
}));

vi.mock('./image-viewer', () => ({
  ImageViewer: () => null
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    external: {
      openInApp: {
        useMutation: () => ({ mutate: mocks.openInAppMutate })
      }
    },
    files: {
      writeFile: {
        useMutation: () => ({ mutateAsync: mocks.writeFileMutateAsync, isPending: false })
      }
    },
    messages: {
      append: {
        useMutation: () => ({ mutateAsync: mocks.appendMessageMutateAsync, isPending: false })
      }
    },
    useUtils: () => ({
      files: {
        readTextFile: {
          invalidate: mocks.invalidateReadTextFile
        }
      },
      messages: {
        getLatest: { invalidate: mocks.invalidateGetLatest },
        getBefore: { invalidate: mocks.invalidateGetBefore },
        getAfter: { invalidate: mocks.invalidateGetAfter }
      }
    })
  }
}));

vi.mock('../hooks/use-file-content', () => ({
  useFileContent: () => ({
    content: 'const count = 1;\n',
    isLoading: false,
    error: null
  }),
  getErrorMessage: (error: string) => error
}));

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../../../test-utils';
import { FileViewerSidebar } from './file-viewer-sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('FileViewerSidebar', () => {
  it('saves edited code and appends a synthetic tool-Write message when subChatId is provided', async () => {
    const { getByText, getByLabelText, queryByText } = renderWithProviders(
      <TooltipProvider>
        <FileViewerSidebar filePath="/repo/example.ts" projectPath="/repo" onClose={vi.fn()} subChatId="sub-123" />
      </TooltipProvider>
    );

    fireEvent.click(getByText('Edit content'));
    fireEvent.change(getByLabelText('Monaco editor'), { target: { value: 'const count = 2;\n' } });
    fireEvent.click(getByText('Save'));

    await waitFor(() => {
      expect(mocks.writeFileMutateAsync).toHaveBeenCalledWith({
        filePath: '/repo/example.ts',
        projectPath: '/repo',
        content: 'const count = 2;\n'
      });
    });

    expect(mocks.appendMessageMutateAsync).toHaveBeenCalledWith({
      subChatId: 'sub-123',
      message: {
        id: expect.any(String),
        role: 'assistant',
        parts: [
          {
            type: 'tool-Write',
            state: 'done',
            input: { file_path: '/repo/example.ts', content: 'const count = 2;\n' },
            output: { content: 'const count = 2;\n' }
          }
        ]
      }
    });

    await waitFor(() => {
      expect(queryByText('Save')).toBeNull();
      expect(getByText('Edit content')).toBeTruthy();
    });
  });
});
