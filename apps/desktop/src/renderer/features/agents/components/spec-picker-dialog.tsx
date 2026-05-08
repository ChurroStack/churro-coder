import { useEffect, useMemo, useState } from 'react';
import { useAtom } from 'jotai';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ClipboardList } from 'lucide-react';
import type { ChangeSummary } from '../../../../main/lib/openspec/types';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '../../../components/ui/command';
import { Kbd } from '../../../components/ui/kbd';
import { cn } from '../../../lib/utils';
import { specPickerOpenAtom } from '../atoms';
import { formatTimeAgo } from '../utils/format-time-ago';

interface SpecPickerDialogProps {
  changes: ChangeSummary[];
  onSelectSpec: (change: ChangeSummary) => void;
}

function getSearchableText(change: ChangeSummary): string {
  return [change.changeId, change.proposal?.title, change.proposal?.why].filter(Boolean).join(' ').toLowerCase();
}

export function SpecPickerDialog({ changes, onSelectSpec }: SpecPickerDialogProps) {
  const [open, setOpen] = useAtom(specPickerOpenAtom);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  const filteredChanges = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return changes;
    }

    return changes.filter((change) => getSearchableText(change).includes(normalized));
  }, [changes, query]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/30 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-[18%] z-50 w-[720px] max-w-[calc(100%-2rem)] -translate-x-1/2 overflow-hidden rounded-3xl border border-border bg-popover shadow-2xl',
            'duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95'
          )}
          onOpenAutoFocus={(event) => event.preventDefault()}>
          <DialogPrimitive.Title className="sr-only">OpenSpec changes</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search all OpenSpec changes for this project
          </DialogPrimitive.Description>
          <Command shouldFilter={false} className="overflow-hidden">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search OpenSpec changes…"
              wrapperClassName="h-12 gap-2 rounded-none border-b border-border bg-transparent px-4"
              className="bg-transparent text-sm"
            />
            <CommandList className="max-h-[420px] py-3">
              {filteredChanges.length === 0 ? (
                <CommandEmpty>No OpenSpec changes match &quot;{query}&quot;.</CommandEmpty>
              ) : (
                filteredChanges.map((change) => (
                  <CommandItem
                    key={change.changeId}
                    value={change.changeId}
                    onSelect={() => {
                      onSelectSpec(change);
                      setOpen(false);
                    }}
                    className="mx-2 gap-3 rounded-2xl px-4 py-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground">
                      <ClipboardList className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {change.proposal?.title || change.changeId}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {change.proposal?.why || 'Continue from this OpenSpec change.'}
                      </div>
                    </div>
                    <div className="shrink-0 text-xs text-muted-foreground">{formatTimeAgo(change.modifiedAt)}</div>
                  </CommandItem>
                ))
              )}
            </CommandList>
            <div className="flex h-9 items-center justify-end gap-3 border-t border-border px-4 text-xs text-muted-foreground/80">
              <span className="flex items-center gap-1.5">
                <Kbd>↵</Kbd>
                <span>select</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>esc</Kbd>
                <span>close</span>
              </span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
