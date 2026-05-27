/**
 * Thin wrapper around `react-resizable-panels` matching the shadcn API.
 * Used inside the CLI panel to host a vertical/horizontal split between
 * the read-only conversation pane and the live xterm terminal.
 *
 * Naming convention vs library:
 *   Our "vertical split"   = panes side-by-side  = library direction="horizontal"
 *   Our "horizontal split" = panes stacked       = library direction="vertical"
 *
 * Always spell this out at the call site — getting it inverted is the kind of
 * thing that bites silently.
 */

import { GripVertical } from 'lucide-react';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type PanelGroupProps,
  type PanelProps,
  type PanelResizeHandleProps
} from 'react-resizable-panels';
import { cn } from '@/lib/utils';

export function ResizablePanelGroup({ className, ...props }: PanelGroupProps) {
  return (
    <PanelGroup
      className={cn('flex h-full w-full data-[panel-group-direction=vertical]:flex-col', className)}
      {...props}
    />
  );
}

export const ResizablePanel = (props: PanelProps) => <Panel {...props} />;

export function ResizableHandle({
  withHandle = true,
  className,
  ...props
}: PanelResizeHandleProps & { withHandle?: boolean }) {
  return (
    <PanelResizeHandle
      className={cn(
        'relative flex w-px items-center justify-center bg-border',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full',
        'data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-2',
        'data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2',
        'data-[panel-group-direction=vertical]:after:translate-x-0',
        'transition-colors hover:bg-primary/30',
        className
      )}
      {...props}>
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
          <GripVertical className="h-2.5 w-2.5" />
        </div>
      )}
    </PanelResizeHandle>
  );
}
