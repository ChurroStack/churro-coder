'use client';

import { memo } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import { cn } from '../../../lib/utils';

// Claude model context windows
const CONTEXT_WINDOWS = {
  opus: 200_000,
  'opus[1m]': 1_000_000,
  sonnet: 200_000,
  'sonnet[1m]': 1_000_000,
  haiku: 200_000
} as const;

type ModelId = keyof typeof CONTEXT_WINDOWS;

// Pre-computed token data to avoid re-computing on every render
export interface MessageTokenData {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  messageCount: number;
  contextWindow?: number;
}

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

export function resolveContextWindow(args: {
  modelId: string | undefined;
  metadataWindow: number | undefined;
}): number {
  const claudeWindow = args.modelId !== undefined ? CONTEXT_WINDOWS[args.modelId as ModelId] : undefined;
  const metadataWindow = args.metadataWindow !== undefined && args.metadataWindow > 0 ? args.metadataWindow : undefined;

  return claudeWindow ?? metadataWindow ?? CONTEXT_WINDOWS.sonnet;
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
  const contextWindow = resolveContextWindow({
    modelId,
    metadataWindow: tokenData.contextWindow
  });
  const percentUsed = Math.min(100, (contextTokens / contextWindow) * 100);
  const isEmpty = contextTokens === 0;

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
      </TooltipContent>
    </Tooltip>
  );
});
