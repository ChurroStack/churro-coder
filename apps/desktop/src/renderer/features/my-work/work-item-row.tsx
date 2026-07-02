import { memo, useState, useCallback } from 'react';
import { CircleDot, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { ChatMarkdownRenderer } from '../../components/chat-markdown-renderer';
import type { WorkItem } from '../../../main/lib/work-items/types';

interface WorkItemRowProps {
  item: WorkItem;
  isActive?: boolean;
  hasLocalProject?: boolean;
  resumeChatId?: string | null;
  onStartSession: (item: WorkItem) => void;
  onCloneAndStart?: (item: WorkItem) => void;
  onResumeSession?: (chatId: string) => void;
}

export const WorkItemRow = memo(function WorkItemRow({
  item,
  isActive = false,
  hasLocalProject = true,
  resumeChatId,
  onStartSession,
  onCloneAndStart,
  onResumeSession
}: WorkItemRowProps) {
  const [expanded, setExpanded] = useState(false);
  const updatedAgo = formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true });
  const bodyText = item.body ?? '';
  const hasBody = bodyText.trim().length > 0;

  const handleToggle = useCallback(() => {
    if (hasBody) setExpanded((v) => !v);
  }, [hasBody]);

  const locationLabel = `${item.repoOwner}/${item.repoName} #${item.number}`;

  return (
    <div
      role="listitem"
      aria-label={`issue #${item.number}: ${item.title}`}
      aria-selected={isActive}
      className={cn('group border-b border-border/40 last:border-0', isActive && 'bg-muted/40')}>
      {/* Row header */}
      <div className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors duration-100">
        {/* Expand toggle — doubles as the open-state indicator */}
        <button
          type="button"
          aria-label={expanded ? `Collapse issue #${item.number}` : `Expand issue #${item.number}`}
          aria-expanded={expanded}
          disabled={!hasBody}
          onClick={handleToggle}
          className={cn(
            'mt-0.5 shrink-0 flex items-center justify-center h-4 w-4 rounded transition-colors',
            hasBody ? 'text-green-500 hover:text-green-400 cursor-pointer' : 'text-green-500 cursor-default'
          )}>
          {hasBody ? (
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <CircleDot className="h-4 w-4" />
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <div className={cn('flex-1 min-w-0', hasBody && 'cursor-pointer')} onClick={handleToggle}>
              <p className="text-sm font-medium text-foreground leading-snug truncate" title={item.title}>
                {item.title}
              </p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-xs text-muted-foreground">{locationLabel}</span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">{updatedAgo}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase tracking-wide text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900">
                  <CircleDot className="h-3 w-3 mr-1" />
                  Issue
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  GitHub
                </Badge>
              </div>
              {/* Labels */}
              {item.labels.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {item.labels.map((label) => (
                    <span
                      key={label.name}
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none"
                      style={{
                        backgroundColor: label.color ? `#${label.color}26` : undefined,
                        color: label.color ? `#${label.color}` : undefined,
                        border: label.color ? `1px solid #${label.color}40` : undefined
                      }}>
                      {label.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Actions — shown on hover */}
            <div
              className={cn(
                'flex items-center gap-1 shrink-0 transition-opacity duration-100',
                isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              )}>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open issue #${item.number} on GitHub`}
                className="flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              {resumeChatId ? (
                <Button
                  size="sm"
                  variant="default"
                  aria-label={`Resume session for issue #${item.number}`}
                  className="h-6 px-2 text-xs"
                  onClick={() => onResumeSession?.(resumeChatId)}>
                  Resume session
                </Button>
              ) : hasLocalProject ? (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Start session for issue #${item.number}`}
                  className="h-6 px-2 text-xs"
                  onClick={() => onStartSession(item)}>
                  Start session
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Clone and start session for issue #${item.number}`}
                  className="h-6 px-2 text-xs"
                  onClick={() => onCloneAndStart?.(item)}>
                  Clone &amp; Start
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Expandable description */}
      {expanded && hasBody && (
        <div className="px-4 pb-4 pl-11">
          <div className="rounded-md border border-border/40 bg-muted/20 px-4 py-3 text-sm overflow-auto max-h-96">
            <ChatMarkdownRenderer content={bodyText} size="sm" />
          </div>
        </div>
      )}
    </div>
  );
});
