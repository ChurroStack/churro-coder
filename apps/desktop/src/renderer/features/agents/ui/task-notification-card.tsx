'use client';

import { memo, useState } from 'react';
import { Bot, ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { MemoizedMarkdown } from '../../../components/chat-markdown-renderer';
import { formatTokens, formatDuration } from './agent-format-utils';
import type { TaskNotification } from './task-notification';

interface TaskNotificationCardProps {
  data: TaskNotification;
  /** Stable prefix used to build MemoizedMarkdown's required `id`. */
  idPrefix: string;
}

// Renders a `<task-notification>` (a subagent reporting back) as a collapsed
// Task-style row matching AgentTaskTool, expanding to the full markdown report.
export const TaskNotificationCard = memo(function TaskNotificationCard({ data, idPrefix }: TaskNotificationCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Compact "· 64.2k tok · 36 uses · 2m 39s" metadata, each part guarded.
  const metaParts = [
    data.tokens !== undefined ? `${formatTokens(data.tokens)} tok` : null,
    data.toolUses !== undefined ? `${data.toolUses} ${data.toolUses === 1 ? 'use' : 'uses'}` : null,
    data.durationMs !== undefined ? formatDuration(data.durationMs) : null
  ].filter(Boolean);

  const hasResult = data.result.trim().length > 0;

  return (
    <div className="flex justify-start">
      <div className="w-full">
        {/* Header - clickable to toggle, same style as AgentTaskTool */}
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="group flex items-start gap-1.5 py-0.5 px-2 cursor-pointer w-full text-left">
          <span className="flex-shrink-0 flex items-start pt-[1px]">
            <Bot className="w-3.5 h-3.5 text-muted-foreground/70" />
          </span>
          <span className="flex-1 min-w-0 flex items-center gap-1.5 text-xs min-w-0">
            <span className="font-medium whitespace-nowrap flex-shrink-0 text-muted-foreground truncate">
              {data.agentName}
            </span>
            <span className="text-muted-foreground/60 flex-shrink-0">{data.status}</span>
            {metaParts.length > 0 && (
              <span className="text-muted-foreground/50 tabular-nums flex-shrink-0 truncate">
                · {metaParts.join(' · ')}
              </span>
            )}
            <ChevronRight
              className={cn(
                'w-3.5 h-3.5 text-muted-foreground/60 transition-transform duration-200 ease-out flex-shrink-0',
                isExpanded && 'rotate-90',
                !isExpanded && 'opacity-0 group-hover:opacity-100'
              )}
            />
          </span>
        </button>

        {/* Report body - markdown, only when expanded */}
        {isExpanded && hasResult && (
          <div className="mt-1 ml-3 pl-3 border-l border-border/40 max-h-80 overflow-y-auto">
            <MemoizedMarkdown content={data.result} id={`${idPrefix}-tasknote`} size="sm" />
          </div>
        )}
      </div>
    </div>
  );
});
