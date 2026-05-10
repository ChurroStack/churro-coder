'use client';

import { memo } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import { cn } from '../../../lib/utils';
import { resolveContextWindow, type MessageTokenData } from '../lib/context-usage';
export type { MessageTokenData } from '../lib/context-usage';

interface AgentContextIndicatorProps {
  tokenData: MessageTokenData;
  modelId?: string;
  className?: string;
  onCompact?: () => void;
  isCompacting?: boolean;
  disabled?: boolean;
}

export function progressColorClass(percent: number): string {
  if (percent <= 0) return 'text-muted-foreground/60';
  if (percent <= 40) return 'text-green-500';
  if (percent <= 60) return 'text-yellow-500';
  if (percent <= 80) return 'text-orange-500';
  return 'text-red-500';
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

export function contextStaleHint(args: {
  staleReason?: MessageTokenData['staleReason'];
  contextWindow: number;
  selectedContextWindow: number;
}): string | null {
  if (args.staleReason === 'cross-provider-fallback') {
    return `Showing the last completed turn while the selected model has no usage yet. Selected window: ${formatTokens(args.selectedContextWindow)}.`;
  }
  if (args.staleReason === 'selected-model-mismatch') {
    return `Last completed turn used ${formatTokens(args.contextWindow)} context. Selected model window: ${formatTokens(args.selectedContextWindow)}.`;
  }
  return null;
}

// Circular progress component
function CircularProgress({
  percent,
  size = 18,
  strokeWidth = 2,
  className
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <svg width={size} height={size} className={cn('transform -rotate-90', className)}>
      {/* Background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted-foreground/20"
      />
      {/* Progress circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className={cn('transition-all duration-300', progressColorClass(percent))}
      />
    </svg>
  );
}

export const AgentContextIndicator = memo(function AgentContextIndicator({
  tokenData,
  modelId,
  className,
  onCompact,
  isCompacting,
  disabled
}: AgentContextIndicatorProps) {
  const contextTokens = tokenData.totalInputTokens;
  const selectedContextWindow = resolveContextWindow({
    modelId,
    metadataWindow: tokenData.selectedContextWindow
  });
  const contextWindow = tokenData.contextWindow ?? selectedContextWindow;
  const percentUsed = Math.min(100, (contextTokens / contextWindow) * 100);
  const isEmpty = contextTokens === 0;
  const staleHint = contextStaleHint({
    staleReason: tokenData.staleReason,
    contextWindow,
    selectedContextWindow
  });

  const isClickable = onCompact && !disabled && !isCompacting;

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <div
          onClick={isClickable ? onCompact : undefined}
          className={cn(
            'h-4 w-4 flex items-center justify-center',
            isClickable ? 'cursor-pointer hover:opacity-70 transition-opacity' : 'cursor-default',
            disabled && 'opacity-50',
            className
          )}>
          <CircularProgress
            percent={percentUsed}
            size={14}
            strokeWidth={2.5}
            className={isCompacting ? 'animate-pulse' : undefined}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        <p className="text-xs">
          {isEmpty ? (
            <span className="text-muted-foreground">Context: 0 / {formatTokens(contextWindow)}</span>
          ) : (
            <>
              <span className="font-mono font-medium text-foreground">{percentUsed.toFixed(1)}%</span>
              <span className="text-muted-foreground mx-1">·</span>
              <span className="text-muted-foreground">
                {formatTokens(contextTokens)} / {formatTokens(contextWindow)} context
              </span>
            </>
          )}
        </p>
        {staleHint ? <p className="mt-1 max-w-64 text-[11px] text-muted-foreground">{staleHint}</p> : null}
      </TooltipContent>
    </Tooltip>
  );
});
