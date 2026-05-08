import { useAtom } from 'jotai';
import { ChevronDown, ClipboardList, Loader2 } from 'lucide-react';
import type { ChangeSummary } from '../../../../main/lib/openspec/types';
import { Kbd } from '../../../components/ui/kbd';
import { cn } from '../../../lib/utils';
import { continueFromSpecExpandedAtom, specPickerOpenAtom } from '../atoms';
import { SpecCard } from './spec-card';

interface ContinueFromSpecStripProps {
  changes: ChangeSummary[];
  isLoading?: boolean;
  selectedSpecId: string | null;
  onSelectSpec: (change: ChangeSummary) => void;
}

export function ContinueFromSpecStrip({
  changes,
  isLoading = false,
  selectedSpecId,
  onSelectSpec
}: ContinueFromSpecStripProps) {
  const [expanded, setExpanded] = useAtom(continueFromSpecExpandedAtom);
  const [, setPickerOpen] = useAtom(specPickerOpenAtom);

  if (!isLoading && changes.length === 0) {
    return null;
  }

  const visibleChanges = changes.slice(0, 4);

  return (
    <section className="rounded-md border border-border bg-card/80 backdrop-blur-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
        onClick={() => setExpanded((value) => !value)}>
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
            <ClipboardList className="h-4 w-4" />
          </div>
          <div className="shrink-0 whitespace-nowrap text-[13px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Continue from a spec
          </div>
          <div className="min-w-0 truncate whitespace-nowrap text-sm text-muted-foreground">
            {isLoading ? 'Loading OpenSpec changes…' : `${changes.length} available · pre-fills the wizard`}
          </div>
        </div>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="border-t border-border px-5 py-5">
          {isLoading ? (
            <div aria-label="Loading specs" className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="flex min-h-[164px] animate-pulse flex-col gap-3 rounded-2xl border border-border/70 bg-background/60 p-4">
                  <div className="flex items-center justify-between">
                    <div className="h-9 w-9 rounded-xl bg-muted" />
                    <div className="h-5 w-16 rounded-full bg-muted" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-4 w-2/3 rounded bg-muted" />
                    <div className="h-4 w-full rounded bg-muted" />
                    <div className="h-4 w-4/5 rounded bg-muted" />
                  </div>
                  <div className="mt-auto flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Loading…</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                {visibleChanges.map((change) => (
                  <SpecCard
                    key={change.changeId}
                    change={change}
                    selected={selectedSpecId === change.changeId}
                    onClick={onSelectSpec}
                  />
                ))}
              </div>
              {changes.length > 4 && (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-dashed border-border px-4 py-3">
                  <div className="text-sm text-muted-foreground">Or browse all {changes.length} specs</div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                    onClick={() => setPickerOpen(true)}>
                    <span>See all</span>
                    <Kbd>⌘K</Kbd>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
