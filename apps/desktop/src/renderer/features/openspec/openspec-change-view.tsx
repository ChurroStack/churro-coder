import { useAtom } from 'jotai';
import { ChevronRight, Check, History, Eye, ArrowRight } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '../../components/ui/breadcrumb';
import { Separator } from '../../components/ui/separator';
import { cn } from '../../lib/utils';
import { openSpecChangeStepAtomFamily, openSpecVisitedTasksAtomFamily, type OpenSpecStep } from './atoms';
import { OpenSpecDocument } from './openspec-document';
import { OpenSpecTasksView } from './openspec-tasks-view';

const STEPS: { key: OpenSpecStep; label: string; num: string }[] = [
  { key: 'proposal', label: 'Proposal', num: '01' },
  { key: 'design', label: 'Design', num: '02' },
  { key: 'tasks', label: 'Tasks', num: '03' }
];

interface OpenSpecChangeViewProps {
  changeId: string;
  projectId: string;
}

export function OpenSpecChangeView({ changeId, projectId }: OpenSpecChangeViewProps) {
  const [step, setStep] = useAtom(openSpecChangeStepAtomFamily(changeId));
  const [visitedTasks, setVisitedTasks] = useAtom(openSpecVisitedTasksAtomFamily(changeId));

  const { data: change } = trpc.openspec.readChange.useQuery({ projectId, changeId }, { staleTime: 60_000 });

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

  const title = change?.proposal?.title ?? changeId;
  const capabilities = change?.capabilities ?? [];
  const modifiedAt = change?.modifiedAt ? formatRelativeTime(change.modifiedAt) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header bar */}
      <div className="flex-shrink-0 border-b px-4">
        {/* Breadcrumb row */}
        <div className="flex items-center justify-between h-12">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <span className="text-muted-foreground text-xs">openspec</span>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <span className="text-muted-foreground text-xs">changes</span>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <span className="text-muted-foreground text-xs">{changeId}</span>
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

          {/* Right-side actions */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                // TODO: implement History
              }}>
              <History className="h-3.5 w-3.5 mr-1" />
              History
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                // TODO: implement Review
              }}>
              <Eye className="h-3.5 w-3.5 mr-1" />
              Review
            </Button>
            <Button size="sm" className="h-7 text-xs" disabled={!canContinue} onClick={handleContinue}>
              Continue
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </div>
      </div>

      {/* Document area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto py-10 px-6">
          {step === 'tasks' ? (
            <OpenSpecTasksView projectId={projectId} changeId={changeId} />
          ) : (
            <OpenSpecDocument projectId={projectId} changeId={changeId} kind={step} />
          )}
        </div>
      </div>
    </div>
  );
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
