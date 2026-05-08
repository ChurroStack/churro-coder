import { useMemo } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import { cn } from '../../../lib/utils';
import { formatFull, formatShortDate } from '../lib/format';

export type DailyCommitBucket = {
  date: string;
  commits: number;
};

type Props = {
  daily: DailyCommitBucket[];
  className?: string;
};

const HEIGHT = 160;
const BAR_GAP = 2;
const BAR_MIN = 4;
const LEFT_PAD = 4;
const RIGHT_PAD = 4;

export function DailyCommitsChart({ daily, className }: Props) {
  const { max, tickIndices } = useMemo(() => {
    let m = 0;
    for (const d of daily) m = Math.max(m, d.commits);
    const ticks: number[] = [];
    if (daily.length > 0) {
      ticks.push(0);
      for (let i = 7; i < daily.length - 1; i += 7) ticks.push(i);
      if (daily.length > 1) ticks.push(daily.length - 1);
    }
    return { max: m, tickIndices: ticks };
  }, [daily]);

  const barWidth = 10;
  const innerWidth = LEFT_PAD + RIGHT_PAD + daily.length * (barWidth + BAR_GAP);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="text-xs text-muted-foreground font-medium">Daily commits</div>
      <div className="overflow-x-auto">
        <svg width={Math.max(innerWidth, 200)} height={HEIGHT + 24} role="img" aria-label="Daily commits bar chart">
          {daily.map((d, i) => {
            const h = max > 0 && d.commits > 0 ? Math.max(BAR_MIN, (d.commits / max) * HEIGHT) : BAR_MIN;
            const x = LEFT_PAD + i * (barWidth + BAR_GAP);
            const y = HEIGHT - h;
            return (
              <Tooltip key={d.date}>
                <TooltipTrigger asChild>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={h}
                    rx={1.5}
                    className="fill-foreground"
                    opacity={d.commits > 0 ? 0.9 : 0.1}
                  />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <div className="font-medium">{formatShortDate(d.date)}</div>
                  <div>
                    {formatFull(d.commits)} commit{d.commits !== 1 ? 's' : ''}
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
          {tickIndices.map((i) => {
            const d = daily[i];
            if (!d) return null;
            const x = LEFT_PAD + i * (barWidth + BAR_GAP) + barWidth / 2;
            return (
              <text
                key={`tick-${i}`}
                x={x}
                y={HEIGHT + 14}
                textAnchor="middle"
                fontSize={10}
                className="fill-muted-foreground">
                {formatShortDate(d.date)}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
