import { useAtom, useSetAtom } from 'jotai';
import { Archive, ChevronRight, Check, ShieldCheck, ArrowRight, Square, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../../components/ui/alert-dialog';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '../../components/ui/breadcrumb';
import { Separator } from '../../components/ui/separator';
import { cn } from '../../lib/utils';
import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { useWorkflowActions, useWorkflowState } from '../agents/hooks/use-workflow-state';
import { useStreamingStatusStore } from '../agents/stores/streaming-status-store';
import {
  openSpecChangeStepAtomFamily,
  openSpecCurrentStepAtomFamily,
  openSpecStopHandlerAtomFamily,
  openSpecVisitedTasksAtomFamily,
  pendingChangeArchiveAtomFamily,
  pendingChangeArchivesByChatAtomFamily,
  type OpenSpecStep
} from './atoms';
import { OpenSpecDocument } from './openspec-document';
import { OpenSpecTasksView } from './openspec-tasks-view';
import { useOpenSpecAction } from './use-openspec-action';
import { parseTaskProgress } from '../../../main/lib/openspec/tasks-parser';

const STEPS: { key: OpenSpecStep; label: string; num: string }[] = [
  { key: 'proposal', label: 'Proposal', num: '01' },
  { key: 'design', label: 'Design', num: '02' },
  { key: 'tasks', label: 'Tasks', num: '03' }
];

interface OpenSpecChangeViewProps {
  chatId: string;
  subChatId: string;
  changeId: string;
  changePath: string;
  projectId: string;
}

export function OpenSpecChangeView({ chatId, subChatId, changeId, changePath, projectId }: OpenSpecChangeViewProps) {
  const [step, setStep] = useAtom(openSpecChangeStepAtomFamily(changeId));
  const [visitedTasks, setVisitedTasks] = useAtom(openSpecVisitedTasksAtomFamily(changeId));
  const currentStepAtom = useMemo(() => openSpecCurrentStepAtomFamily(subChatId), [subChatId]);
  const setCurrentStep = useSetAtom(currentStepAtom);
  const stopHandlerAtom = useMemo(() => openSpecStopHandlerAtomFamily(subChatId), [subChatId]);
  const [stopHandler] = useAtom(stopHandlerAtom);
  const isStreaming = useStreamingStatusStore((s) => s.isStreaming(subChatId));
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [pendingArchive, setPendingArchive] = useAtom(pendingChangeArchiveAtomFamily(changeId));
  const setPendingArchivesByChat = useSetAtom(pendingChangeArchivesByChatAtomFamily(chatId));

  const trpcUtils = trpc.useUtils();
  const wasStreaming = useRef(false);

  const { data: change } = trpc.openspec.readChange.useQuery({ chatId, changeId }, { staleTime: 60_000 });
  const { data: tasksFile } = trpc.openspec.readChangeFile.useQuery(
    { chatId, changeId, kind: 'tasks' },
    { staleTime: 30_000 }
  );
  const tasksProgress = useMemo(() => (tasksFile ? parseTaskProgress(tasksFile.content) : null), [tasksFile]);
  const runOpenSpecAction = useOpenSpecAction({ chatId, projectId, changeId, changePath }, subChatId);
  const workflow = useWorkflowState(chatId, subChatId);
  const { dispatch: dispatchWorkflowAction } = useWorkflowActions(chatId, subChatId);

  const { data: activeChanges } = trpc.openspec.listChanges.useQuery(
    { chatId },
    { staleTime: 30_000, enabled: archiveDialogOpen }
  );
  const { data: chat } = trpc.chats.get.useQuery({ id: chatId }, { enabled: archiveDialogOpen });
  const chatSnapshot = chat as
    | { worktreePath?: string | null; prUrl?: string | null; prNumber?: number | null }
    | null
    | undefined;
  const worktreePath = chatSnapshot?.worktreePath ?? null;
  const {
    data: gitStatus,
    isLoading: isGitStatusLoading,
    isFetching: isGitStatusFetching
  } = trpc.changes.getStatus.useQuery(
    { worktreePath: worktreePath ?? '' },
    { enabled: archiveDialogOpen && !!worktreePath, staleTime: 5_000 }
  );
  const {
    data: prStatusData,
    isLoading: isPrStatusLoading,
    isFetching: isPrStatusFetching
  } = trpc.chats.getPrStatus.useQuery(
    { chatId },
    { enabled: archiveDialogOpen && !!worktreePath && !!gitStatus?.hasRemote, staleTime: 5_000 }
  );
  const otherActiveCount = (activeChanges ?? []).filter((c) => c.changeId !== changeId).length;
  const isArchiving = pendingArchive !== null;
  const archiveReadiness = useMemo(
    () =>
      getArchiveReadiness({
        tasksProgress,
        hasWorktree: !!worktreePath,
        gitStatus,
        hasPr: Boolean(prStatusData?.pr || chatSnapshot?.prUrl || chatSnapshot?.prNumber)
      }),
    [chatSnapshot?.prNumber, chatSnapshot?.prUrl, gitStatus, prStatusData?.pr, tasksProgress, worktreePath]
  );
  const isCheckingArchiveReadiness =
    archiveDialogOpen &&
    !!worktreePath &&
    (isGitStatusLoading || isGitStatusFetching || (gitStatus?.hasRemote && (isPrStatusLoading || isPrStatusFetching)));

  trpc.openspec.watchChange.useSubscription(
    { chatId, changeId },
    {
      enabled: !isArchiving,
      onData: () => {
        void trpcUtils.openspec.readChangeFile.invalidate({ chatId, changeId });
        void trpcUtils.openspec.readChange.invalidate({ chatId, changeId });
      },
      onError: (err) =>
        console.warn(`[openspec/viewer] watchChange ended archiving=${isArchiving} changeId=${changeId}`, err)
    }
  );

  useEffect(() => {
    setCurrentStep(step);
  }, [setCurrentStep, step]);

  // Invalidate document queries when the agent session finishes so the viewer
  // reflects the files the agent just wrote without requiring a manual tab switch.
  useEffect(() => {
    if (wasStreaming.current && !isStreaming) {
      void trpcUtils.openspec.readChangeFile.invalidate({ chatId, changeId });
      void trpcUtils.openspec.readChange.invalidate({ chatId, changeId });
      console.log(`[openspec/viewer] session ended — refreshing docs changeId=${changeId}`);
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming, trpcUtils, chatId, changeId]);

  const handleStepChange = (next: OpenSpecStep) => {
    if (next === 'tasks') setVisitedTasks(true);
    console.log(`[openspec/viewer] step changed from=${step} to=${next}`);
    setStep(next);
  };

  const handleContinue = () => {
    const idx = STEPS.findIndex((s) => s.key === step);
    if (idx < STEPS.length - 1) {
      handleStepChange(STEPS[idx + 1]!.key);
    }
  };

  const canContinue = step !== 'tasks';
  const canArchive = step === 'tasks' && !isStreaming && !isArchiving;

  const handleArchiveConfirm = () => {
    if (!archiveReadiness.ready) {
      toast.error('Archive is blocked', { description: archiveReadiness.blockers[0] });
      return;
    }
    setArchiveDialogOpen(false);
    const pending = { chatId, subChatId, changeId, startedAt: Date.now() };
    setPendingArchive(pending);
    setPendingArchivesByChat((prev) => ({ ...prev, [changeId]: pending }));
    void runOpenSpecAction('/opsx:archive', 'execute');
    console.log(`[openspec/viewer] archive requested changeId=${changeId} subChatId=${subChatId}`);
  };

  const handleVerify = () => {
    console.log(`[openspec/viewer] verify requested changeId=${changeId} subChatId=${subChatId} step=${step}`);
    void runOpenSpecAction('/opsx:verify', 'execute');
  };

  const handleCodeReview = () => {
    console.log(`[openspec/viewer] code review requested changeId=${changeId} subChatId=${subChatId}`);
    void dispatchWorkflowAction(workflow?.review.actionKind ?? 'reviewLocal');
  };

  const capabilities = change?.capabilities ?? [];
  const modifiedAt = change?.modifiedAt ? formatRelativeTime(change.modifiedAt) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header bar */}
      <div className="flex-shrink-0 border-b px-4">
        {/* Breadcrumb row */}
        <div className="flex items-center justify-between h-8">
          <Breadcrumb>
            <BreadcrumbList className="flex-nowrap">
              <BreadcrumbItem className="min-w-0">
                <span
                  className="text-muted-foreground text-xs truncate inline-block max-w-[280px] align-middle"
                  title={changeId}>
                  {changeId}
                </span>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="text-xs">{step}.md</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex items-center gap-2">
            {capabilities.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {capabilities.join(' · ')}
              </Badge>
            )}
            {modifiedAt && <span className="text-xs text-muted-foreground">Updated {modifiedAt}</span>}
          </div>
        </div>

        {/* Phase indicator row */}
        <div className="flex items-center h-10 gap-2">
          <div className="flex items-center gap-1 flex-1">
            {STEPS.map((s, i) => {
              const isCurrent = step === s.key;
              const isPast = STEPS.findIndex((x) => x.key === step) > i;
              const showMayRegen = s.key === 'tasks' && visitedTasks && step !== 'tasks';

              return (
                <div key={s.key} className="flex items-center gap-1">
                  {i > 0 && <Separator orientation="horizontal" className="w-4" />}
                  <button
                    className={cn(
                      'flex items-center gap-1 text-xs rounded px-1.5 py-0.5 transition-colors',
                      isCurrent
                        ? 'font-semibold text-foreground bg-muted'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    onClick={() => handleStepChange(s.key)}>
                    {isPast ? <Check className="h-3 w-3 text-green-500" /> : <span className="font-mono">{s.num}</span>}
                    <span>{s.label}</span>
                    {showMayRegen && <span className="text-orange-400/70 text-[10px] ml-0.5">· may regen</span>}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Task progress pill */}
          {tasksProgress && tasksProgress.total > 0 && (
            <div className="flex items-center gap-2 px-2">
              <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${Math.round((tasksProgress.done / tasksProgress.total) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {tasksProgress.done}/{tasksProgress.total}
              </span>
            </div>
          )}

          {/* Right-side actions */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={isStreaming} onClick={handleVerify}>
              <ShieldCheck className="h-3.5 w-3.5 mr-1" />
              Verify
            </Button>
            {isStreaming && stopHandler && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void stopHandler()}>
                <Square className="h-3.5 w-3.5 mr-1" />
                Stop
              </Button>
            )}
            {step === 'tasks' ? (
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={!canArchive}
                onClick={() => setArchiveDialogOpen(true)}>
                <Archive className="h-3.5 w-3.5 mr-1" />
                {isArchiving ? 'Archiving…' : 'Archive'}
              </Button>
            ) : (
              <Button size="sm" className="h-7 text-xs" disabled={!canContinue} onClick={handleContinue}>
                Continue
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Document area */}
      <div className="flex-1 overflow-y-auto relative">
        <div className="max-w-5xl mx-auto py-10 px-6">
          <OpenSpecDocumentBoundary isArchiving={isArchiving}>
            {step === 'tasks' ? (
              <OpenSpecTasksView
                chatId={chatId}
                subChatId={subChatId}
                projectId={projectId}
                changeId={changeId}
                changePath={changePath}
                onCodeReview={handleCodeReview}
              />
            ) : (
              <OpenSpecDocument chatId={chatId} changeId={changeId} kind={step} />
            )}
          </OpenSpecDocumentBoundary>
        </div>
        {isArchiving && (
          <div className="absolute inset-0 bg-background/70 backdrop-blur-sm flex items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Archiving change…
            </div>
          </div>
        )}
      </div>
      <AlertDialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this change?</AlertDialogTitle>
            <AlertDialogDescription>
              The AI will move <span className="font-medium text-foreground">{changeId}</span> into{' '}
              <code className="text-xs">openspec/changes/archive/</code>.
              {otherActiveCount === 0
                ? ' Since this is the only active change in the workspace, the workspace will also be archived without deleting files.'
                : ` ${otherActiveCount} other active change${otherActiveCount === 1 ? '' : 's'} will keep the workspace open.`}
            </AlertDialogDescription>
            {worktreePath && (
              <div className="mt-3 rounded-md border bg-muted/30 p-3 text-xs">
                <div className="font-medium text-foreground">Before archiving</div>
                {isCheckingArchiveReadiness ? (
                  <div className="mt-2 flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Checking git and PR status…
                  </div>
                ) : archiveReadiness.ready ? (
                  <div className="mt-2 text-muted-foreground">Code is committed, pushed, and PR-ready.</div>
                ) : (
                  <ul className="mt-2 space-y-1 text-muted-foreground">
                    {archiveReadiness.blockers.map((blocker) => (
                      <li key={blocker}>• {blocker}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleArchiveConfirm}
              disabled={isCheckingArchiveReadiness || !archiveReadiness.ready}
              autoFocus>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

class OpenSpecDocumentBoundary extends Component<{ isArchiving: boolean; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.warn('[openspec/viewer] document render failed', { error, componentStack: errorInfo.componentStack });
  }

  componentDidUpdate(prevProps: { isArchiving: boolean }) {
    if (prevProps.isArchiving && !this.props.isArchiving && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError && this.props.isArchiving) {
      return null;
    }
    if (this.state.hasError) {
      return (
        <div className="py-20 text-center text-sm text-muted-foreground">Unable to render this OpenSpec change.</div>
      );
    }
    return this.props.children;
  }
}

function getArchiveReadiness({
  tasksProgress,
  hasWorktree,
  gitStatus,
  hasPr
}: {
  tasksProgress: { total: number; done: number } | null;
  hasWorktree: boolean;
  gitStatus:
    | {
        staged: unknown[];
        unstaged: unknown[];
        untracked: unknown[];
        pushCount: number;
        hasUpstream: boolean;
        hasRemote: boolean;
      }
    | null
    | undefined;
  hasPr: boolean;
}): { ready: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (!tasksProgress || tasksProgress.total === 0) {
    blockers.push('Complete all tasks before archiving.');
  } else if (tasksProgress.done < tasksProgress.total) {
    blockers.push(`Complete all tasks before archiving (${tasksProgress.done}/${tasksProgress.total} done).`);
  }

  if (!hasWorktree) return { ready: blockers.length === 0, blockers };
  if (!gitStatus) return { ready: false, blockers: [...blockers, 'Checking git status…'] };

  const uncommittedCount = gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length;
  if (uncommittedCount > 0) {
    blockers.push(`Commit ${uncommittedCount} uncommitted file${uncommittedCount === 1 ? '' : 's'}.`);
  }

  if (gitStatus.hasRemote) {
    if (!gitStatus.hasUpstream) {
      blockers.push('Publish this branch to origin.');
    } else if (gitStatus.pushCount > 0) {
      blockers.push(`Push ${gitStatus.pushCount} commit${gitStatus.pushCount === 1 ? '' : 's'} to origin.`);
    }

    if (!hasPr) {
      blockers.push('Create a pull request for this branch.');
    }
  }

  return { ready: blockers.length === 0, blockers };
}

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}
