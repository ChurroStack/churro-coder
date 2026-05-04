'use client';

/**
 * Diff sidebar module extracted from active-chat.tsx (Phase 3).
 *
 * Bundles the four cohesive pieces of the diff-sidebar surface:
 *
 *   1. `DiffStateContext` + `useDiffState` — internal context that isolates
 *      diff state from `ChatView` so a file-selection change doesn't
 *      re-render the chat orchestrator.
 *   2. `DiffStateProvider` — owns the diff atom subscriptions, the
 *      auto-select-first-file effect, the close handler with `flushSync`
 *      reset (React-19 ContextMenu cleanup workaround), and the viewed-count
 *      state. Wraps the children in `DiffStateContext.Provider`.
 *   3. `DiffSidebarContent` — file list (ChangesPanel) + AgentDiffView with
 *      responsive narrow/wide layouts. Reads from the diff context.
 *   4. `DiffSidebarRenderer` — the outer wrapper that picks one of three
 *      display modes (side-peek / center-peek / full-page) and mounts the
 *      content inside the right shell.
 *
 * Extraction rules followed:
 *   - No behavioral change. The context value, prop interfaces, and effects
 *     are byte-equivalent to the active-chat.tsx originals; only the file
 *     boundary moved.
 *   - The consumer (active-chat.tsx) imports `DiffStateProvider` and
 *     `DiffSidebarRenderer` plus the types — same surface as before.
 */

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { flushSync } from 'react-dom';
import { useAtom, useAtomValue } from 'jotai';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import { IconCloseSidebarRight } from '../../../components/ui/icons';
import { ResizableSidebar } from '../../../components/ui/resizable-sidebar';
import { cn } from '../../../lib/utils';
import { trpc } from '../../../lib/trpc';
import type { FileStatus } from '../../../../shared/changes-types';
import { ChangesPanel } from '../../changes';
import { DiffCenterPeekDialog } from '../../changes/components/diff-center-peek-dialog';
import { DiffFullPageView } from '../../changes/components/diff-full-page-view';
import { DiffSidebarHeader } from '../../changes/components/diff-sidebar-header';
import { getStatusIndicator } from '../../changes/utils/status';
import {
  agentsChangesPanelCollapsedAtom,
  agentsChangesPanelWidthAtom,
  agentsDiffSidebarWidthAtom,
  diffActiveTabAtom,
  filteredDiffFilesAtom,
  filteredSubChatIdAtom,
  selectedCommitAtom,
  selectedDiffFilePathAtom,
  type SelectedCommit
} from '../atoms';
import { useAgentSubChatStore } from '../stores/sub-chat-store';
import { AgentDiffView, type AgentDiffViewRef, type DiffViewMode, type ParsedDiffFile } from '../ui/agent-diff-view';

// ============================================================================
// DiffStateContext - isolates diff state management to prevent ChatView re-renders
// ============================================================================

interface DiffStateContextValue {
  selectedFilePath: string | null;
  filteredSubChatId: string | null;
  viewedCount: number;
  handleDiffFileSelect: (file: { path: string }, category: string) => void;
  handleSelectNextFile: (filePath: string) => void;
  handleCommitSuccess: () => void;
  handleCloseDiff: () => void;
  handleViewedCountChange: (count: number) => void;
  /** Ref to register a function that resets activeTab to "changes" before closing */
  resetActiveTabRef: React.MutableRefObject<(() => void) | null>;
}

const DiffStateContext = createContext<DiffStateContextValue | null>(null);

export function useDiffState(): DiffStateContextValue {
  const ctx = useContext(DiffStateContext);
  if (!ctx) throw new Error('useDiffState must be used within DiffStateProvider');
  return ctx;
}

// ============================================================================
// CommitFileItem - row in the History tab's "Files in commit" list
// ============================================================================

const CommitFileItem = memo(function CommitFileItem({
  file,
  onClick
}: {
  file: { path: string; status: FileStatus };
  onClick: () => void;
}) {
  const fileName = file.path.split('/').pop() || file.path;
  const dirPath = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '';

  return (
    <div
      className={cn('flex items-center gap-2 px-2 py-1 cursor-pointer transition-colors', 'hover:bg-muted/80')}
      onClick={onClick}>
      <div className="flex-1 min-w-0 flex items-center overflow-hidden">
        {dirPath && <span className="text-xs text-muted-foreground truncate flex-shrink min-w-0">{dirPath}/</span>}
        <span className="text-xs font-medium flex-shrink-0 whitespace-nowrap">{fileName}</span>
      </div>
      <div className="shrink-0">{getStatusIndicator(file.status)}</div>
    </div>
  );
});

// ============================================================================
// DiffSidebarContent - file list + diff with responsive layout
// ============================================================================

export interface DiffSidebarContentProps {
  worktreePath: string | null;
  selectedFilePath: string | null;
  onFileSelect: (file: { path: string }, category: string) => void;
  chatId: string;
  sandboxId: string | null;
  repository: { owner: string; name: string } | null;
  diffStats: { isLoading: boolean; hasChanges: boolean; fileCount: number; additions: number; deletions: number };
  setDiffStats: (stats: {
    isLoading: boolean;
    hasChanges: boolean;
    fileCount: number;
    additions: number;
    deletions: number;
  }) => void;
  diffContent: string | null;
  parsedFileDiffs: unknown;
  prefetchedFileContents: Record<string, string> | undefined;
  /**
   * AgentDiffView emits `{ allCollapsed, allExpanded }` snapshots whenever
   * the per-file expansion state changes. The renderer uses this to drive
   * the "expand all" / "collapse all" header buttons. (The original
   * inline definition typed this as `Map<string, boolean>` which never
   * matched the runtime shape — a latent bug fixed during the Phase 3
   * extraction.)
   */
  setDiffCollapseState: (state: { allCollapsed: boolean; allExpanded: boolean }) => void;
  diffViewRef: React.RefObject<{
    expandAll: () => void;
    collapseAll: () => void;
    getViewedCount: () => number;
    markAllViewed: () => void;
    markAllUnviewed: () => void;
  } | null>;
  agentChat: { prUrl?: string; prNumber?: number } | null | undefined;
  sidebarWidth: number;
  onCommitWithAI?: () => void;
  isCommittingWithAI?: boolean;
  diffMode: DiffViewMode;
  setDiffMode: (mode: DiffViewMode) => void;
  onCreatePr?: () => void;
  onCommitSuccess?: () => void;
  onDiscardSuccess?: () => void;
  subChats?: Array<{ id: string; name: string; filePaths: string[]; fileCount: number }>;
  initialSubChatFilter?: string | null;
  onSelectNextFile?: (filePath: string) => void;
}

const DiffSidebarContent = memo(function DiffSidebarContent({
  worktreePath,
  chatId,
  sandboxId,
  repository,
  diffStats,
  setDiffStats,
  diffContent,
  parsedFileDiffs,
  prefetchedFileContents,
  setDiffCollapseState,
  diffViewRef,
  agentChat,
  sidebarWidth,
  onCommitWithAI,
  isCommittingWithAI = false,
  diffMode,
  setDiffMode,
  onCreatePr,
  onDiscardSuccess,
  subChats = []
}: Omit<
  DiffSidebarContentProps,
  'selectedFilePath' | 'onFileSelect' | 'onCommitSuccess' | 'initialSubChatFilter' | 'onSelectNextFile'
>) {
  const {
    selectedFilePath,
    filteredSubChatId,
    handleDiffFileSelect,
    handleSelectNextFile,
    handleCommitSuccess,
    handleViewedCountChange,
    resetActiveTabRef
  } = useDiffState();

  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId);

  const initialSelectedFile = useMemo(() => {
    if (selectedFilePath) return selectedFilePath;
    if (Array.isArray(parsedFileDiffs) && parsedFileDiffs.length > 0) {
      const firstFile = parsedFileDiffs[0] as ParsedDiffFile;
      const filePath = firstFile.newPath !== '/dev/null' ? firstFile.newPath : firstFile.oldPath;
      if (filePath && filePath !== '/dev/null') {
        return filePath;
      }
    }
    return null;
  }, [selectedFilePath, parsedFileDiffs]);

  const [changesPanelWidth, setChangesPanelWidth] = useAtom(agentsChangesPanelWidthAtom);
  const [, setIsChangesPanelCollapsed] = useAtom(agentsChangesPanelCollapsedAtom);
  const [isResizing, setIsResizing] = useState(false);

  const [activeTab, setActiveTab] = useAtom(diffActiveTabAtom);

  useEffect(() => {
    resetActiveTabRef.current = () => setActiveTab('changes');
    return () => {
      resetActiveTabRef.current = null;
    };
  }, [resetActiveTabRef, setActiveTab]);

  const [selectedCommit, setSelectedCommit] = useAtom(selectedCommitAtom);

  useEffect(() => {
    setSelectedCommit(null);
  }, [worktreePath, setSelectedCommit]);

  const isNarrow = sidebarWidth < 500;

  const { data: diffStatus } = trpc.changes.getStatus.useQuery(
    { worktreePath: worktreePath || '' },
    { enabled: !!worktreePath && isNarrow }
  );

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startWidth = changesPanelWidth;
      const pointerId = event.pointerId;
      const handleElement = event.currentTarget as HTMLElement;

      const minWidth = 200;
      const maxWidth = 450;

      const clampWidth = (width: number) => Math.max(minWidth, Math.min(maxWidth, width));

      handleElement.setPointerCapture?.(pointerId);
      setIsResizing(true);

      const handlePointerMove = (e: PointerEvent) => {
        const delta = e.clientX - startX;
        const newWidth = clampWidth(startWidth + delta);
        setChangesPanelWidth(newWidth);
      };

      const handlePointerUp = () => {
        if (handleElement.hasPointerCapture?.(pointerId)) {
          handleElement.releasePointerCapture(pointerId);
        }
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        setIsResizing(false);
      };

      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp, { once: true });
    },
    [changesPanelWidth, setChangesPanelWidth]
  );

  const handleCommitSelect = useCallback(
    (commit: SelectedCommit) => {
      setSelectedCommit(commit);
    },
    [setSelectedCommit]
  );

  const handleCommitFileSelect = useCallback(
    (file: { path: string }, _commitHash: string) => {
      handleDiffFileSelect(file, '');
    },
    [handleDiffFileSelect]
  );

  const { data: commitFiles } = trpc.changes.getCommitFiles.useQuery(
    {
      worktreePath: worktreePath || '',
      commitHash: selectedCommit?.hash || ''
    },
    {
      enabled: !!worktreePath && !!selectedCommit,
      staleTime: 60_000
    }
  );

  const { data: commitFileDiff } = trpc.changes.getCommitFileDiff.useQuery(
    {
      worktreePath: worktreePath || '',
      commitHash: selectedCommit?.hash || '',
      filePath: selectedFilePath || ''
    },
    {
      enabled: !!worktreePath && !!selectedCommit && !!selectedFilePath,
      staleTime: 60_000
    }
  );

  const shouldUseCommitDiff = activeTab === 'history' && selectedCommit;
  const effectiveDiff = shouldUseCommitDiff && commitFileDiff ? commitFileDiff : diffContent;
  const effectiveParsedFiles = shouldUseCommitDiff ? null : (parsedFileDiffs as ParsedDiffFile[] | null);
  const effectivePrefetchedContents = shouldUseCommitDiff ? {} : prefetchedFileContents;

  if (isNarrow) {
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {worktreePath && (
          <div
            className={cn(
              'flex-shrink-0 overflow-hidden flex flex-col',
              'h-[45%] min-h-[200px] border-b border-border/50'
            )}>
            <ChangesPanel
              worktreePath={worktreePath}
              activeTab={activeTab}
              selectedFilePath={selectedFilePath}
              onFileSelect={handleDiffFileSelect}
              onFileOpenPinned={() => {}}
              onCreatePr={onCreatePr}
              onCommitSuccess={handleCommitSuccess}
              onDiscardSuccess={onDiscardSuccess}
              subChats={subChats}
              initialSubChatFilter={filteredSubChatId}
              activeSubChatId={activeSubChatId}
              chatId={chatId}
              selectedCommitHash={selectedCommit?.hash}
              onCommitSelect={handleCommitSelect}
              onCommitFileSelect={handleCommitFileSelect}
              onActiveTabChange={setActiveTab}
              pushCount={(diffStatus as { pushCount?: number } | undefined)?.pushCount}
            />
          </div>
        )}
        <div className="flex-1 overflow-hidden flex flex-col relative">
          <div
            className={cn(
              'absolute inset-0 overflow-y-auto',
              activeTab === 'history' && selectedCommit ? 'z-10' : 'z-0 invisible'
            )}>
            {selectedCommit &&
              (!commitFiles ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                  Loading files...
                </div>
              ) : commitFiles.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                  No files changed in this commit
                </div>
              ) : (
                <>
                  <div className="px-3 py-2 border-b border-border/50">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="text-sm font-medium text-foreground flex-1">{selectedCommit.message}</div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(selectedCommit.hash);
                          toast.success('Copied SHA to clipboard');
                        }}
                        className="text-xs font-mono text-muted-foreground hover:text-foreground underline cursor-pointer shrink-0">
                        {selectedCommit.shortHash}
                      </button>
                    </div>
                    {selectedCommit.description && (
                      <div className="text-xs text-foreground/80 mb-2 whitespace-pre-wrap">
                        {selectedCommit.description}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {selectedCommit.author} •{' '}
                      {selectedCommit.date ? new Date(selectedCommit.date).toLocaleString() : 'Unknown date'}
                    </div>
                  </div>

                  <div className="px-2 py-1.5 text-xs text-muted-foreground font-medium bg-muted/30 border-b border-border/50">
                    Files in commit ({commitFiles.length})
                  </div>
                  {commitFiles.map((file) => (
                    <CommitFileItem key={file.path} file={file} onClick={() => {}} />
                  ))}
                </>
              ))}
          </div>
          <div
            className={cn(
              'absolute inset-0 overflow-hidden',
              activeTab === 'history' && selectedCommit ? 'z-0 invisible' : 'z-10'
            )}>
            <AgentDiffView
              ref={diffViewRef as React.RefObject<AgentDiffViewRef | null>}
              chatId={chatId}
              sandboxId={sandboxId ?? ''}
              worktreePath={worktreePath || undefined}
              repository={repository ? `${repository.owner}/${repository.name}` : undefined}
              onStatsChange={setDiffStats}
              initialDiff={effectiveDiff}
              initialParsedFiles={effectiveParsedFiles}
              prefetchedFileContents={effectivePrefetchedContents}
              showFooter={false}
              onCollapsedStateChange={setDiffCollapseState}
              onSelectNextFile={handleSelectNextFile}
              onViewedCountChange={handleViewedCountChange}
              initialSelectedFile={initialSelectedFile}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {worktreePath && (
        <div className="h-full flex-shrink-0 relative" style={{ width: changesPanelWidth }}>
          <ChangesPanel
            worktreePath={worktreePath}
            activeTab={activeTab}
            selectedFilePath={selectedFilePath}
            onFileSelect={handleDiffFileSelect}
            onFileOpenPinned={() => {}}
            onCreatePr={onCreatePr}
            onCommitSuccess={handleCommitSuccess}
            onDiscardSuccess={onDiscardSuccess}
            subChats={subChats}
            initialSubChatFilter={filteredSubChatId}
            chatId={chatId}
            selectedCommitHash={selectedCommit?.hash}
            onCommitSelect={handleCommitSelect}
            onCommitFileSelect={handleCommitFileSelect}
            onActiveTabChange={setActiveTab}
            pushCount={(diffStatus as { pushCount?: number } | undefined)?.pushCount}
          />
          <div
            onPointerDown={handleResizePointerDown}
            className="absolute top-0 bottom-0 cursor-col-resize z-10"
            style={{
              right: 0,
              width: '4px',
              marginRight: '-2px'
            }}
          />
        </div>
      )}
      <div className={cn('flex-1 h-full min-w-0 overflow-hidden relative', 'border-l border-border/50')}>
        <div
          className={cn(
            'absolute inset-0 overflow-y-auto',
            activeTab === 'history' && selectedCommit ? 'z-10' : 'z-0 invisible'
          )}>
          {selectedCommit &&
            (!commitFiles ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                Loading files...
              </div>
            ) : commitFiles.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                No files changed in this commit
              </div>
            ) : (
              <>
                <div className="px-3 py-2 border-b border-border/50">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="text-sm font-medium text-foreground flex-1">{selectedCommit.message}</div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(selectedCommit.hash);
                        toast.success('Copied SHA to clipboard');
                      }}
                      className="text-xs font-mono text-muted-foreground hover:text-foreground underline cursor-pointer shrink-0">
                      {selectedCommit.shortHash}
                    </button>
                  </div>
                  {selectedCommit.description && (
                    <div className="text-xs text-foreground/80 mb-2 whitespace-pre-wrap">
                      {selectedCommit.description}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {selectedCommit.author} •{' '}
                    {selectedCommit.date ? new Date(selectedCommit.date).toLocaleString() : 'Unknown date'}
                  </div>
                </div>

                <div className="px-2 py-1.5 text-xs text-muted-foreground font-medium bg-muted/30 border-b border-border/50">
                  Files in commit ({commitFiles.length})
                </div>
                {commitFiles.map((file) => (
                  <CommitFileItem key={file.path} file={file} onClick={() => {}} />
                ))}
              </>
            ))}
        </div>
        <div
          className={cn(
            'absolute inset-0 overflow-hidden',
            activeTab === 'history' && selectedCommit ? 'z-0 invisible' : 'z-10'
          )}>
          <AgentDiffView
            ref={diffViewRef as React.RefObject<AgentDiffViewRef | null>}
            chatId={chatId}
            sandboxId={sandboxId ?? ''}
            worktreePath={worktreePath || undefined}
            repository={repository ? `${repository.owner}/${repository.name}` : undefined}
            onStatsChange={setDiffStats}
            initialDiff={effectiveDiff}
            initialParsedFiles={effectiveParsedFiles}
            prefetchedFileContents={effectivePrefetchedContents}
            showFooter={true}
            onCollapsedStateChange={setDiffCollapseState}
            onSelectNextFile={handleSelectNextFile}
            onViewedCountChange={handleViewedCountChange}
            initialSelectedFile={initialSelectedFile}
          />
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// DiffStateProvider - manages diff state in isolation from ChatView
// ============================================================================

interface DiffStateProviderProps {
  isDiffSidebarOpen: boolean;
  parsedFileDiffs: ParsedDiffFile[] | null;
  isDiffSidebarNarrow: boolean;
  setIsDiffSidebarOpen: (open: boolean) => void;
  setDiffStats: (stats: {
    isLoading: boolean;
    hasChanges: boolean;
    fileCount: number;
    additions: number;
    deletions: number;
  }) => void;
  setDiffContent: (content: string | null) => void;
  setParsedFileDiffs: (files: ParsedDiffFile[] | null) => void;
  setPrefetchedFileContents: (contents: Record<string, string>) => void;
  fetchDiffStats: () => void;
  children: ReactNode;
}

export const DiffStateProvider = memo(function DiffStateProvider({
  isDiffSidebarOpen,
  parsedFileDiffs,
  isDiffSidebarNarrow,
  setIsDiffSidebarOpen,
  setDiffStats,
  setDiffContent,
  setParsedFileDiffs,
  setPrefetchedFileContents,
  fetchDiffStats,
  children
}: DiffStateProviderProps) {
  const [viewedCount, setViewedCount] = useState(0);

  // Ref for resetting activeTab to "changes" before closing.
  // This prevents React 19 ref cleanup issues with HistoryView's ContextMenu components.
  const resetActiveTabRef = useRef<(() => void) | null>(null);

  const [selectedFilePath, setSelectedFilePath] = useAtom(selectedDiffFilePathAtom);
  const [, setFilteredDiffFiles] = useAtom(filteredDiffFilesAtom);
  const [filteredSubChatId, setFilteredSubChatId] = useAtom(filteredSubChatIdAtom);
  const isChangesPanelCollapsed = useAtomValue(agentsChangesPanelCollapsedAtom);

  // Auto-select first file when diff sidebar opens — useLayoutEffect for synchronous update.
  useLayoutEffect(() => {
    if (!isDiffSidebarOpen) {
      setSelectedFilePath(null);
      setFilteredDiffFiles(null);
      return;
    }

    let fileToSelect = selectedFilePath;
    if (!fileToSelect && parsedFileDiffs && parsedFileDiffs.length > 0) {
      const firstFile = parsedFileDiffs[0];
      fileToSelect = firstFile.newPath !== '/dev/null' ? firstFile.newPath : firstFile.oldPath;
      if (fileToSelect && fileToSelect !== '/dev/null') {
        setSelectedFilePath(fileToSelect);
      }
    }

    const shouldShowAllFiles = isDiffSidebarNarrow && isChangesPanelCollapsed;

    if (shouldShowAllFiles) {
      setFilteredDiffFiles(null);
    } else if (fileToSelect) {
      setFilteredDiffFiles([fileToSelect]);
    } else {
      setFilteredDiffFiles(null);
    }
  }, [
    isDiffSidebarOpen,
    selectedFilePath,
    parsedFileDiffs,
    isDiffSidebarNarrow,
    isChangesPanelCollapsed,
    setFilteredDiffFiles,
    setSelectedFilePath
  ]);

  const handleDiffFileSelect = useCallback(
    (file: { path: string }, _category: string) => {
      setSelectedFilePath(file.path);
      setFilteredDiffFiles([file.path]);
    },
    [setSelectedFilePath, setFilteredDiffFiles]
  );

  const handleSelectNextFile = useCallback(
    (filePath: string) => {
      setSelectedFilePath(filePath);
      setFilteredDiffFiles([filePath]);
    },
    [setSelectedFilePath, setFilteredDiffFiles]
  );

  const handleCommitSuccess = useCallback(() => {
    setSelectedFilePath(null);
    setFilteredDiffFiles(null);
    setParsedFileDiffs(null);
    setDiffContent(null);
    setPrefetchedFileContents({});
    setDiffStats({
      fileCount: 0,
      additions: 0,
      deletions: 0,
      isLoading: true,
      hasChanges: false
    });
    setTimeout(() => {
      fetchDiffStats();
    }, 2000);
  }, [
    setSelectedFilePath,
    setFilteredDiffFiles,
    setParsedFileDiffs,
    setDiffContent,
    setPrefetchedFileContents,
    setDiffStats,
    fetchDiffStats
  ]);

  const handleCloseDiff = useCallback(() => {
    // Use flushSync to reset activeTab synchronously before closing.
    // Unmounts HistoryView's ContextMenu components in a single commit, preventing
    // React 19 ref cleanup "Maximum update depth exceeded" error.
    flushSync(() => {
      resetActiveTabRef.current?.();
    });
    setIsDiffSidebarOpen(false);
    setFilteredSubChatId(null);
  }, [setIsDiffSidebarOpen, setFilteredSubChatId]);

  const handleViewedCountChange = useCallback((count: number) => {
    setViewedCount(count);
  }, []);

  const contextValue = useMemo(
    () => ({
      selectedFilePath,
      filteredSubChatId,
      viewedCount,
      handleDiffFileSelect,
      handleSelectNextFile,
      handleCommitSuccess,
      handleCloseDiff,
      handleViewedCountChange,
      resetActiveTabRef
    }),
    [
      selectedFilePath,
      filteredSubChatId,
      viewedCount,
      handleDiffFileSelect,
      handleSelectNextFile,
      handleCommitSuccess,
      handleCloseDiff,
      handleViewedCountChange
    ]
  );

  return <DiffStateContext.Provider value={contextValue}>{children}</DiffStateContext.Provider>;
});

// ============================================================================
// DiffSidebarRenderer - renders the diff sidebar in the active display mode
// ============================================================================

export interface DiffSidebarRendererProps {
  worktreePath: string | null;
  chatId: string;
  sandboxId: string | null;
  repository: { owner: string; name: string } | null;
  diffStats: { isLoading: boolean; hasChanges: boolean; fileCount: number; additions: number; deletions: number };
  diffContent: string | null;
  parsedFileDiffs: ParsedDiffFile[] | null;
  prefetchedFileContents: Record<string, string>;
  setDiffCollapseState: (state: { allCollapsed: boolean; allExpanded: boolean }) => void;
  diffViewRef: React.RefObject<AgentDiffViewRef | null>;
  diffSidebarRef: React.RefObject<HTMLDivElement | null>;
  agentChat: { prUrl?: string; prNumber?: number } | null | undefined;
  branchData: { current: string } | undefined;
  gitStatus:
    | {
        pushCount?: number;
        pullCount?: number;
        hasUpstream?: boolean;
        ahead?: number;
        behind?: number;
        staged?: any[];
        unstaged?: any[];
        untracked?: any[];
      }
    | undefined;
  isGitStatusLoading: boolean;
  isDiffSidebarOpen: boolean;
  diffDisplayMode: 'side-peek' | 'center-peek' | 'full-page';
  diffSidebarWidth: number;
  handleReview: () => void;
  isReviewing: boolean;
  handleCreatePrDirect: () => void;
  handleCreatePr: () => void;
  isCreatingPr: boolean;
  handleMergePr: () => void;
  mergePrMutation: { isPending: boolean };
  handleRefreshGitStatus: () => void;
  hasPrNumber: boolean;
  isPrOpen: boolean;
  hasMergeConflicts: boolean;
  handleFixConflicts: () => void;
  handleExpandAll: () => void;
  handleCollapseAll: () => void;
  diffMode: DiffViewMode;
  setDiffMode: (mode: DiffViewMode) => void;
  handleMarkAllViewed: () => void;
  handleMarkAllUnviewed: () => void;
  isDesktop: boolean;
  isFullscreen: boolean;
  setDiffDisplayMode: (mode: 'side-peek' | 'center-peek' | 'full-page') => void;
  handleCommitToPr: (selectedPaths?: string[]) => void;
  isCommittingToPr: boolean;
  subChatsWithFiles: Array<{ id: string; name: string; filePaths: string[]; fileCount: number }>;
  setDiffStats: (stats: {
    isLoading: boolean;
    hasChanges: boolean;
    fileCount: number;
    additions: number;
    deletions: number;
  }) => void;
  onDiscardSuccess?: () => void;
}

export const DiffSidebarRenderer = memo(function DiffSidebarRenderer({
  worktreePath,
  chatId,
  sandboxId,
  repository,
  diffStats,
  diffContent,
  parsedFileDiffs,
  prefetchedFileContents,
  setDiffCollapseState,
  diffViewRef,
  diffSidebarRef,
  agentChat,
  branchData,
  gitStatus,
  isGitStatusLoading,
  isDiffSidebarOpen,
  diffDisplayMode,
  diffSidebarWidth,
  handleReview,
  isReviewing,
  handleCreatePrDirect,
  handleCreatePr,
  isCreatingPr,
  handleMergePr,
  mergePrMutation,
  handleRefreshGitStatus,
  hasPrNumber,
  isPrOpen,
  hasMergeConflicts,
  handleFixConflicts,
  handleExpandAll,
  handleCollapseAll,
  diffMode,
  setDiffMode,
  handleMarkAllViewed,
  handleMarkAllUnviewed,
  isDesktop,
  isFullscreen,
  setDiffDisplayMode,
  handleCommitToPr,
  isCommittingToPr,
  subChatsWithFiles,
  setDiffStats,
  onDiscardSuccess
}: DiffSidebarRendererProps) {
  const { handleCloseDiff, viewedCount, handleViewedCountChange } = useDiffState();

  const handleReviewWithAI = useCallback(() => {
    if (diffDisplayMode !== 'side-peek') {
      handleCloseDiff();
    }
    handleReview();
  }, [diffDisplayMode, handleCloseDiff, handleReview]);

  const handleCreatePrWithAI = useCallback(() => {
    if (diffDisplayMode !== 'side-peek') {
      handleCloseDiff();
    }
    handleCreatePr();
  }, [diffDisplayMode, handleCloseDiff, handleCreatePr]);

  const effectiveWidth =
    diffDisplayMode === 'side-peek'
      ? diffSidebarWidth
      : diffDisplayMode === 'center-peek'
        ? 1200
        : typeof window !== 'undefined'
          ? window.innerWidth
          : 1200;

  const diffViewContent = (
    <div ref={diffSidebarRef} className="flex flex-col h-full min-w-0 overflow-hidden">
      {worktreePath ? (
        <DiffSidebarHeader
          worktreePath={worktreePath}
          currentBranch={branchData?.current ?? ''}
          diffStats={diffStats}
          sidebarWidth={effectiveWidth}
          pushCount={gitStatus?.pushCount ?? 0}
          pullCount={gitStatus?.pullCount ?? 0}
          hasUpstream={gitStatus?.hasUpstream ?? true}
          isSyncStatusLoading={isGitStatusLoading}
          aheadOfDefault={gitStatus?.ahead ?? 0}
          behindDefault={gitStatus?.behind ?? 0}
          onReview={handleReviewWithAI}
          isReviewing={isReviewing}
          onCreatePr={handleCreatePrDirect}
          isCreatingPr={isCreatingPr}
          onCreatePrWithAI={handleCreatePrWithAI}
          isCreatingPrWithAI={isCreatingPr}
          onMergePr={handleMergePr}
          isMergingPr={mergePrMutation.isPending}
          onClose={handleCloseDiff}
          onRefresh={handleRefreshGitStatus}
          hasPrNumber={hasPrNumber}
          isPrOpen={isPrOpen}
          hasMergeConflicts={hasMergeConflicts}
          onFixConflicts={handleFixConflicts}
          onExpandAll={handleExpandAll}
          onCollapseAll={handleCollapseAll}
          viewMode={diffMode}
          onViewModeChange={setDiffMode}
          viewedCount={viewedCount}
          onMarkAllViewed={handleMarkAllViewed}
          onMarkAllUnviewed={handleMarkAllUnviewed}
          isDesktop={isDesktop}
          isFullscreen={isFullscreen}
          displayMode={diffDisplayMode}
          onDisplayModeChange={setDiffDisplayMode}
        />
      ) : sandboxId ? (
        <div className="flex items-center h-10 px-2 border-b border-border/50 bg-background flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 flex-shrink-0 hover:bg-foreground/10"
            onClick={handleCloseDiff}>
            <IconCloseSidebarRight className="size-4 text-muted-foreground" />
          </Button>
          <span className="text-sm text-muted-foreground ml-2">Changes</span>
        </div>
      ) : null}

      <DiffSidebarContent
        worktreePath={worktreePath}
        chatId={chatId}
        sandboxId={sandboxId}
        repository={repository}
        diffStats={diffStats}
        setDiffStats={setDiffStats}
        diffContent={diffContent}
        parsedFileDiffs={parsedFileDiffs}
        prefetchedFileContents={prefetchedFileContents}
        setDiffCollapseState={setDiffCollapseState}
        diffViewRef={diffViewRef}
        agentChat={agentChat}
        sidebarWidth={effectiveWidth}
        onCommitWithAI={handleCommitToPr}
        isCommittingWithAI={isCommittingToPr}
        diffMode={diffMode}
        setDiffMode={setDiffMode}
        onCreatePr={handleCreatePrDirect}
        onDiscardSuccess={onDiscardSuccess}
        subChats={subChatsWithFiles}
      />
    </div>
  );

  if (diffDisplayMode === 'side-peek') {
    return (
      <ResizableSidebar
        isOpen={isDiffSidebarOpen}
        onClose={handleCloseDiff}
        widthAtom={agentsDiffSidebarWidthAtom}
        minWidth={320}
        side="right"
        animationDuration={0}
        initialWidth={0}
        exitWidth={0}
        showResizeTooltip={true}
        className="bg-background border-l"
        style={{ borderLeftWidth: '0.5px', overflow: 'hidden' }}>
        {diffViewContent}
      </ResizableSidebar>
    );
  }

  if (diffDisplayMode === 'center-peek') {
    return (
      <DiffCenterPeekDialog isOpen={isDiffSidebarOpen} onClose={handleCloseDiff}>
        {diffViewContent}
      </DiffCenterPeekDialog>
    );
  }

  if (diffDisplayMode === 'full-page') {
    return (
      <DiffFullPageView isOpen={isDiffSidebarOpen} onClose={handleCloseDiff}>
        {diffViewContent}
      </DiffFullPageView>
    );
  }

  return null;
});
