import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useTheme } from 'next-themes';
import { useAtom } from 'jotai';
import { useAtomValue } from 'jotai';
import { Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { MarkdownIcon, CodeIcon } from '@/components/ui/icons';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { preferredEditorAtom } from '@/lib/atoms';
import { useResolvedHotkeyDisplay } from '@/lib/hotkeys';
import { APP_META } from '../../../../shared/external-apps';
import { ChatMarkdownRenderer } from '@/components/chat-markdown-renderer';
import { CopyButton } from '../../agents/ui/message-action-buttons';
import { EDITOR_ICONS } from '@/lib/editor-icons';
import { fileViewerWordWrapAtom } from '../../agents/atoms';
import { FindBar } from '../../find/find-bar';
import { markCurrentFindScope } from '../../find/constants';
import { useDomTextFind } from '../../find/use-dom-text-find';
import { useFindScope } from '../../find/use-find-scope';
import { fileDraftUtils, useFileDraft } from '../use-file-draft';
import { getEditorOptions, getMonacoTheme } from './monaco-config';
import { DraftConflictBanner, EditModeButtons, type FileViewerDockApi, UnsavedChangesDialog } from './editor-editing';
import { FileTitleBlock } from './file-title-block';

interface MarkdownViewerProps {
  filePath: string;
  projectPath: string;
  onClose: () => void;
  showHeader?: boolean;
  subChatId?: string;
  dockApi?: FileViewerDockApi;
}

export function MarkdownViewer({
  filePath,
  projectPath,
  onClose,
  showHeader = false,
  subChatId,
  dockApi
}: MarkdownViewerProps) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const { resolvedTheme } = useTheme();
  const monacoTheme = getMonacoTheme(resolvedTheme || 'dark');
  const absolutePath = useMemo(
    () => (filePath.startsWith('/') ? filePath : `${projectPath}/${filePath}`),
    [filePath, projectPath]
  );
  const fileName = useMemo(() => filePath.split('/').pop() || filePath, [filePath]);

  const [showPreview, setShowPreview] = useState(true);
  const [wordWrap] = useAtom(fileViewerWordWrapAtom);
  const [isEditMode, setIsEditMode] = useState(false);
  const [currentContent, setCurrentContent] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editBaseContent, setEditBaseContent] = useState('');
  const [discardDialogAction, setDiscardDialogAction] = useState<'discard' | 'close' | 'toggle-preview' | null>(null);
  const [draftConflictAt, setDraftConflictAt] = useState<number | null>(null);
  const findScope = useFindScope(scopeRef, showPreview);
  const utils = trpc.useUtils();
  const writeFileMutation = trpc.files.writeFile.useMutation();
  const appendMessageMutation = trpc.messages.append.useMutation();
  const hasRestoredDraftRef = useRef(false);
  const draftPersistedRef = useRef(false);
  const { saveDraft, clearDraft, loadDraft } = useFileDraft(absolutePath, editBaseContent || currentContent);

  const effectiveContent = isEditMode ? editContent : currentContent;

  const { data, isLoading, error, refetch } = trpc.files.readTextFile.useQuery(
    { filePath: absolutePath },
    { staleTime: 30000 }
  );

  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  const relativePath = useMemo(() => {
    if (!filePath.startsWith('/')) return filePath;
    if (filePath.startsWith(projectPath)) {
      return filePath.slice(projectPath.length + 1);
    }
    return filePath;
  }, [projectPath, filePath]);

  trpc.files.watchChanges.useSubscription(
    { projectPath },
    {
      enabled: !!projectPath && !!relativePath,
      onData: (change) => {
        if (change.filename === relativePath) {
          refetchRef.current();
        }
      }
    }
  );

  useEffect(() => {
    hasRestoredDraftRef.current = false;
    draftPersistedRef.current = false;
    setShowPreview(true);
    setIsEditMode(false);
    setCurrentContent('');
    setEditContent('');
    setEditBaseContent('');
    setDiscardDialogAction(null);
    setDraftConflictAt(null);
  }, [absolutePath]);

  useEffect(() => {
    if (!data?.ok || isEditMode) return;
    setCurrentContent(data.content);
  }, [data, isEditMode]);

  useEffect(() => {
    if (!data?.ok || hasRestoredDraftRef.current) return;
    hasRestoredDraftRef.current = true;
    setCurrentContent(data.content);

    const draft = loadDraft();
    if (!draft) return;

    setEditBaseContent(data.content);
    setEditContent(draft.content);
    setDraftConflictAt(null);
    setShowPreview(false);
    setIsEditMode(true);
    draftPersistedRef.current = true;

    void fileDraftUtils.sha1(data.content).then((hash) => {
      setDraftConflictAt(hash === draft.originalHash ? null : draft.draftedAt);
    });
  }, [data, loadDraft]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: !isEditMode });
  }, [isEditMode]);

  useEffect(() => {
    if (!dockApi) return;
    dockApi.setTitle(isEditMode ? `• ${fileName}` : fileName);

    return () => {
      dockApi.setTitle(fileName);
    };
  }, [dockApi, fileName, isEditMode]);

  useEffect(() => {
    if (!isEditMode) return;
    if (editContent === editBaseContent) {
      clearDraft();
      draftPersistedRef.current = false;
      return;
    }
    const timeoutId = window.setTimeout(() => {
      saveDraft(editContent);
      draftPersistedRef.current = true;
    }, 500);
    return () => window.clearTimeout(timeoutId);
  }, [clearDraft, editBaseContent, editContent, isEditMode, saveDraft]);

  const exitEditMode = useCallback(() => {
    setIsEditMode(false);
    setDiscardDialogAction(null);
    setDraftConflictAt(null);
    draftPersistedRef.current = false;
  }, []);

  const handleEnterEditMode = useCallback(() => {
    setEditBaseContent(currentContent);
    setEditContent(currentContent);
    setDraftConflictAt(null);
    setShowPreview(false);
    setIsEditMode(true);
    draftPersistedRef.current = false;
  }, [currentContent]);

  const handleRequestClose = useCallback(() => {
    if (isEditMode) {
      setDiscardDialogAction('close');
      return;
    }
    onClose();
  }, [isEditMode, onClose]);

  const handleToggleView = useCallback(() => {
    if (!showPreview && isEditMode) {
      setDiscardDialogAction('toggle-preview');
      return;
    }
    setShowPreview((prev) => !prev);
  }, [isEditMode, showPreview]);

  const handleConfirmDiscard = useCallback(() => {
    const action = discardDialogAction;
    clearDraft();
    setEditContent(editBaseContent);
    exitEditMode();

    if (action === 'close') {
      onClose();
      return;
    }

    if (action === 'toggle-preview') {
      setShowPreview(true);
    }
  }, [clearDraft, discardDialogAction, editBaseContent, exitEditMode, onClose]);

  const handleSave = useCallback(async () => {
    const nextContent = editContent;
    try {
      await writeFileMutation.mutateAsync({ filePath: absolutePath, projectPath, content: nextContent });
      setCurrentContent(nextContent);
      clearDraft();
      exitEditMode();
      await utils.files.readTextFile.invalidate({ filePath: absolutePath });

      if (!subChatId) return;

      await appendMessageMutation.mutateAsync({
        subChatId,
        message: {
          id: crypto.randomUUID(),
          role: 'assistant',
          parts: [
            {
              type: 'tool-Write',
              state: 'done',
              input: { file_path: absolutePath, content: nextContent },
              output: { content: nextContent }
            }
          ]
        }
      });

      // Rely on message-query invalidation so the existing change-tracking hook
      // remains the single source of truth for subChatFilesAtom recomputation.
      await Promise.allSettled([
        utils.messages.getLatest.invalidate(),
        utils.messages.getBefore.invalidate(),
        utils.messages.getAfter.invalidate()
      ]);
    } catch (error) {
      toast.error('Failed to save file', {
        description: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }, [
    absolutePath,
    appendMessageMutation,
    clearDraft,
    editContent,
    exitEditMode,
    projectPath,
    subChatId,
    utils.files.readTextFile,
    utils.messages.getAfter,
    utils.messages.getBefore,
    utils.messages.getLatest,
    writeFileMutation
  ]);

  const handleUndo = useCallback(() => {
    editorRef.current?.focus();
    editorRef.current?.trigger('toolbar', 'undo', null);
  }, []);

  const handleRedo = useCallback(() => {
    editorRef.current?.focus();
    editorRef.current?.trigger('toolbar', 'redo', null);
  }, []);

  const editorOptions = useMemo(
    () => ({
      ...getEditorOptions(!isEditMode),
      wordWrap: wordWrap ? ('on' as const) : ('off' as const)
    }),
    [isEditMode, wordWrap]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleRequestClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRequestClose]);

  useEffect(() => {
    if (!showPreview) return;

    const handleFindKeyDown = (e: KeyboardEvent) => {
      const isFindHotkey = e.code === 'KeyF' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;
      if (!isFindHotkey) return;

      const scope = scopeRef.current;
      if (!scope || scope.getClientRects().length === 0) return;

      e.preventDefault();
      e.stopPropagation();
      markCurrentFindScope(scope);
      if (findScope.isOpen) {
        findScope.bumpSelectionVersion();
      } else {
        findScope.setIsOpen(true);
      }
    };

    window.addEventListener('keydown', handleFindKeyDown, true);
    return () => window.removeEventListener('keydown', handleFindKeyDown, true);
  }, [findScope, showPreview]);

  const domFind = useDomTextFind({
    rootRef: previewRef,
    contentKey: `${absolutePath}:${currentContent}`,
    enabled: showPreview
  });

  useEffect(() => {
    if (showPreview) return;
    findScope.setIsOpen(false);
    domFind.close();
  }, [domFind, findScope, showPreview]);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-background">
        <Header
          filePath={filePath}
          showPreview={showPreview}
          onToggleView={handleToggleView}
          showHeader={showHeader}
          onClose={handleRequestClose}
          isEditMode={false}
          onEnterEditMode={() => {}}
          onSave={() => {}}
          onDiscard={() => {}}
          onUndo={() => {}}
          onRedo={() => {}}
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="text-sm">Loading file...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error || (data && !data.ok)) {
    let errorMessage = 'Failed to load file';
    if (data && !data.ok) {
      errorMessage =
        data.reason === 'too-large' ? 'File too large' : data.reason === 'binary' ? 'Binary file' : 'File not found';
    }

    return (
      <div className="flex flex-col h-full bg-background">
        <Header
          filePath={filePath}
          showPreview={showPreview}
          onToggleView={handleToggleView}
          showHeader={showHeader}
          onClose={handleRequestClose}
          isEditMode={false}
          onEnterEditMode={() => {}}
          onSave={() => {}}
          onDiscard={() => {}}
          onUndo={() => {}}
          onRedo={() => {}}
        />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="flex flex-col items-center gap-3 text-center max-w-[300px]">
            <AlertCircle className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium text-foreground">{errorMessage}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={scopeRef} className="relative flex flex-col h-full bg-background">
      <Header
        filePath={filePath}
        showPreview={showPreview}
        onToggleView={handleToggleView}
        content={effectiveContent}
        showHeader={showHeader}
        onClose={handleRequestClose}
        isEditMode={isEditMode}
        isSaving={writeFileMutation.isPending || appendMessageMutation.isPending}
        onEnterEditMode={handleEnterEditMode}
        onSave={() => void handleSave()}
        onDiscard={() => setDiscardDialogAction('discard')}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />
      <FindBar
        isOpen={findScope.isOpen && showPreview}
        query={domFind.query}
        current={domFind.current}
        total={domFind.total}
        selectionVersion={findScope.selectionVersion}
        searchCompleted={domFind.searchCompleted}
        onQueryChange={domFind.setQuery}
        onClose={() => {
          findScope.setIsOpen(false);
          domFind.close();
        }}
        onNext={domFind.next}
        onPrev={domFind.prev}
      />
      {draftConflictAt !== null && !showPreview && <DraftConflictBanner draftedAt={draftConflictAt} />}
      <div className="flex-1 min-h-0 overflow-hidden allow-text-selection" data-file-viewer-path={filePath}>
        {showPreview ? (
          <div ref={previewRef} className="h-full overflow-auto p-6">
            <ChatMarkdownRenderer content={currentContent} size="md" />
          </div>
        ) : (
          <Editor
            height="100%"
            language="markdown"
            value={effectiveContent}
            theme={monacoTheme}
            options={editorOptions}
            loading={
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            }
            onMount={(instance) => {
              editorRef.current = instance;
            }}
            onChange={(value) => {
              if (isEditMode) {
                setEditContent(value ?? '');
              }
            }}
          />
        )}
      </div>
      <UnsavedChangesDialog
        open={discardDialogAction !== null}
        title={
          discardDialogAction === 'close'
            ? 'Discard all changes?'
            : discardDialogAction === 'toggle-preview'
              ? 'Discard changes before leaving source view?'
              : 'Discard changes?'
        }
        description={
          discardDialogAction === 'close'
            ? 'Are you sure you want to discard all changes?'
            : discardDialogAction === 'toggle-preview'
              ? 'Switching back to preview will discard your unsaved source changes.'
              : 'Are you sure you want to discard your changes?'
        }
        onOpenChange={(open) => {
          if (!open) setDiscardDialogAction(null);
        }}
        onConfirm={handleConfirmDiscard}
      />
    </div>
  );
}

function Header({
  filePath,
  showPreview,
  onToggleView,
  content,
  showHeader = false,
  onClose,
  isEditMode,
  isSaving,
  onEnterEditMode,
  onSave,
  onDiscard,
  onUndo,
  onRedo
}: {
  filePath: string;
  showPreview: boolean;
  onToggleView: () => void;
  content?: string;
  showHeader?: boolean;
  onClose?: () => void;
  isEditMode: boolean;
  isSaving?: boolean;
  onEnterEditMode: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const preferredEditor = useAtomValue(preferredEditorAtom);
  const editorMeta = APP_META[preferredEditor];
  const openInAppMutation = trpc.external.openInApp.useMutation();
  const openInEditorHotkey = useResolvedHotkeyDisplay('open-in-editor');

  const handleOpenInEditor = useCallback(() => {
    const absolutePath = filePath.startsWith('/') ? filePath : undefined;
    if (absolutePath) {
      openInAppMutation.mutate({ path: absolutePath, app: preferredEditor });
    }
  }, [filePath, preferredEditor, openInAppMutation]);

  return (
    <div
      className={`@container flex items-center ${showHeader ? 'justify-between' : 'justify-end'} px-2 h-10 border-b border-border/50 bg-background flex-shrink-0`}
      style={{
        WebkitAppRegion: 'no-drag'
      }}>
      {showHeader && onClose && <FileTitleBlock filePath={filePath} onClose={onClose} />}
      <div className="flex items-center gap-1 flex-shrink-0">
        {!showPreview && (
          <EditModeButtons
            isEditMode={isEditMode}
            isSaving={isSaving}
            onEnterEditMode={onEnterEditMode}
            onSave={onSave}
            onDiscard={onDiscard}
            onUndo={onUndo}
            onRedo={onRedo}
          />
        )}

        <Tooltip delayDuration={500}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleOpenInEditor}
              className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer rounded-md px-1.5 py-1 hover:bg-accent hover:text-accent-foreground transition-colors">
              <span className="hidden @[400px]:inline">Open in</span>
              {EDITOR_ICONS[preferredEditor] && (
                <img src={EDITOR_ICONS[preferredEditor]} alt="" className="h-3.5 w-3.5 flex-shrink-0" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" showArrow={false}>
            Open in {editorMeta.label}
            {openInEditorHotkey && <Kbd className="normal-case font-sans">{openInEditorHotkey}</Kbd>}
          </TooltipContent>
        </Tooltip>

        {content && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleView}
                className="h-6 w-6 p-0 hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
                aria-label={showPreview ? 'Show source' : 'Show rendered'}>
                <div className="relative w-4 h-4">
                  <MarkdownIcon
                    className={cn(
                      'absolute inset-0 w-4 h-4 transition-[opacity,transform] duration-200 ease-out',
                      showPreview ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
                    )}
                  />
                  <CodeIcon
                    className={cn(
                      'absolute inset-0 w-4 h-4 transition-[opacity,transform] duration-200 ease-out',
                      !showPreview ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
                    )}
                  />
                </div>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" showArrow={false}>
              {showPreview ? 'View source' : 'View rendered'}
            </TooltipContent>
          </Tooltip>
        )}

        {content && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <CopyButton text={content} />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" showArrow={false}>
              Copy file content
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
