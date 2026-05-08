import { formatRelativeDate, formatShortHash } from '../lib/format';

export type RecentCommit = {
  hash: string;
  author: string;
  dateISO: string;
  subject: string;
};

type Props = {
  commits: RecentCommit[];
};

export function RecentCommitsList({ commits }: Props) {
  if (commits.length === 0) {
    return <div className="text-sm text-muted-foreground">No commits found.</div>;
  }
  return (
    <div className="flex flex-col divide-y divide-border/50">
      {commits.map((c) => (
        <div key={c.hash} className="py-2.5 flex items-start gap-3 group">
          <code className="text-xs text-muted-foreground tabular-nums mt-0.5 flex-shrink-0 w-14">
            {formatShortHash(c.hash)}
          </code>
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate" title={c.subject}>
              {c.subject || '(no message)'}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {c.author} · {formatRelativeDate(c.dateISO)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
