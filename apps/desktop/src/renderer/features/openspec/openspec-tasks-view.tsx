import { Loader2, Play, CheckCircle2, Circle, Square, ChevronDown, ChevronRight, Eye } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Progress } from '../../components/ui/progress';
import { Checkbox } from '../../components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible';
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
import { cn } from '../../lib/utils';
import { parseTasksOutline, type Task } from '../../../main/lib/openspec/tasks-outline';
import { parseTaskProgress } from '../../../main/lib/openspec/tasks-parser';
import { useAtom } from 'jotai';
import { useMemo, useState } from 'react';
import { useStreamingStatusStore } from '../agents/stores/streaming-status-store';
import { openSpecStopHandlerAtomFamily } from './atoms';
import { useOpenSpecAction } from './use-openspec-action';

interface OpenSpecTasksViewProps {
  chatId: string;
  subChatId: string;
  projectId: string;
  changeId: string;
  changePath: string;
  onCodeReview: () => void;
}

function toggleTaskInContent(content: string, lineIndex: number, done: boolean): string {
  const lines = content.split('\n');
  const line = lines[lineIndex];
  if (!line) return content;
  lines[lineIndex] = done ? line.replace(/\[ \]/, '[x]') : line.replace(/\[[xX]\]/, '[ ]');
  return lines.join('\n');
}

export function OpenSpecTasksView({
  chatId,
  subChatId,
  projectId,
  changeId,
  changePath,
  onCodeReview
}: OpenSpecTasksViewProps) {
  const { data, isLoading, error } = trpc.openspec.readChangeFile.useQuery(
    { chatId, changeId, kind: 'tasks' },
    { staleTime: 30_000 }
  );
  const isStreaming = useStreamingStatusStore((s) => s.isStreaming(subChatId));
  const stopHandlerAtom = useMemo(() => openSpecStopHandlerAtomFamily(subChatId), [subChatId]);
  const [stopHandler] = useAtom(stopHandlerAtom);
  const runOpenSpecAction = useOpenSpecAction({ chatId, projectId, changeId, changePath }, subChatId);
  const writeChangeFile = trpc.openspec.writeChangeFile.useMutation();

  const [pendingCheck, setPendingCheck] = useState<Task | null>(null);

  const outline = useMemo(() => (data ? parseTasksOutline(data.content) : null), [data]);
  const progress = useMemo(() => (data ? parseTaskProgress(data.content) : { total: 0, done: 0 }), [data]);

  const applyToggle = (task: Task, newDone: boolean) => {
    if (!data) return;
    const updated = toggleTaskInContent(data.content, task.lineIndex, newDone);
    writeChangeFile.mutate(
      { chatId, changeId, kind: 'tasks', content: updated },
      {
        onError: (err) => console.error(`[openspec/tasks] toggle failed taskId=${task.id}`, err)
      }
    );
    console.log(`[openspec/tasks] manual toggle taskId=${task.id} done=${newDone}`);
  };

  const handleTaskToggle = (task: Task, newDone: boolean) => {
    if (newDone) {
      setPendingCheck(task);
    } else {
      applyToggle(task, false);
    }
  };

  const handleConfirmCheck = () => {
    if (pendingCheck) applyToggle(pendingCheck, true);
    setPendingCheck(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Loading tasks.md…</span>
      </div>
    );
  }

  if (error || !data || !outline) {
    return <div className="py-20 text-center text-sm text-muted-foreground">tasks.md not found in this change.</div>;
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <>
      <div className="space-y-6">
        {/* Run-bar card */}
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium flex items-center gap-2">
                {progress.done} of {progress.total} tasks complete
                {isStreaming && (
                  <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Implementing…
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{pct}%</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={isStreaming} onClick={onCodeReview}>
                <Eye className="h-3.5 w-3.5 mr-1.5" />
                Code review
              </Button>
              {isStreaming && stopHandler ? (
                <Button size="sm" variant="outline" onClick={() => void stopHandler()}>
                  <Square className="h-3.5 w-3.5 mr-1.5" />
                  Stop
                </Button>
              ) : (
                <Button size="sm" disabled={isStreaming} onClick={() => void runOpenSpecAction('/opsx:apply', 'apply')}>
                  {isStreaming ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {isStreaming ? 'Implementing tasks' : 'Implement all tasks'}
                </Button>
              )}
            </div>
          </div>
          <Progress value={pct} />
        </div>

        {/* Sections */}
        {outline.sections.map((section, si) => {
          const sectionDone = section.tasks.filter((t) => t.done).length;
          const sectionTotal = section.tasks.length;
          const allDone = sectionDone === sectionTotal && sectionTotal > 0;
          return (
            <TaskSectionBlock
              key={si}
              title={section.title}
              tasks={section.tasks}
              done={sectionDone}
              total={sectionTotal}
              allDone={allDone}
              isStreaming={isStreaming}
              onRunSection={(scope) => void runOpenSpecAction(`/opsx:apply ${scope}`, 'apply')}
              onRunTask={(scope) => void runOpenSpecAction(`/opsx:apply ${scope}`, 'apply')}
              onToggleTask={handleTaskToggle}
            />
          );
        })}
      </div>

      {/* Manual-check confirmation dialog */}
      <AlertDialog
        open={pendingCheck !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCheck(null);
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark task as done?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription className="px-5 pb-2">
            <span className="font-mono text-xs text-muted-foreground mr-1.5">{pendingCheck?.id}</span>
            <span className="font-medium text-foreground">{pendingCheck?.title}</span>
            <br />
            <span className="text-xs mt-1 block">Confirm you have completed this step manually.</span>
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmCheck} autoFocus>
              Mark done
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TaskSectionBlock({
  title,
  tasks,
  done,
  total,
  allDone,
  isStreaming,
  onRunSection,
  onRunTask,
  onToggleTask
}: {
  title: string;
  tasks: ReturnType<typeof parseTasksOutline>['sections'][number]['tasks'];
  done: number;
  total: number;
  allDone: boolean;
  isStreaming: boolean;
  onRunSection: (scope: string) => void;
  onRunTask: (scope: string) => void;
  onToggleTask: (task: Task, newDone: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const sectionScope = title.match(/^(\d+)\.?/)?.[1];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/40 group">
        <CollapsibleTrigger asChild>
          <button className="flex min-w-0 flex-1 items-center gap-2 text-left">
            {open ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            )}
            {allDone ? (
              <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            )}
            <span className="flex-1 truncate text-sm font-medium">{title}</span>
            <Badge variant="secondary" className="text-xs">
              {done}/{total}
            </Badge>
          </button>
        </CollapsibleTrigger>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          disabled={isStreaming || !sectionScope}
          onClick={() => {
            if (sectionScope) onRunSection(sectionScope);
          }}>
          <Play className="h-3 w-3" />
        </Button>
      </div>
      <CollapsibleContent>
        <div className="mt-1 space-y-0.5">
          {tasks.map((task, ti) => (
            <div
              key={ti}
              className={cn('flex items-start gap-3 px-8 py-1.5 rounded-md text-sm group', task.depth > 0 && 'pl-12')}>
              <Checkbox
                checked={task.done}
                disabled={isStreaming}
                className="mt-0.5 flex-shrink-0"
                onCheckedChange={(checked) => onToggleTask(task, Boolean(checked))}
              />
              <div className="flex-1 min-w-0">
                <span className={cn('text-sm', task.done && 'line-through text-muted-foreground')}>
                  <span className="text-muted-foreground mr-1.5 font-mono text-xs">{task.id}</span>
                  {task.title}
                </span>
                {task.filePath && (
                  <span className="ml-2 text-xs text-muted-foreground font-mono truncate">{task.filePath}</span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                disabled={isStreaming}
                onClick={() => onRunTask(task.id)}>
                <Play className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
