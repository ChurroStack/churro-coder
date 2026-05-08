import { formatCompact } from '../lib/format';

export type ContributorRow = {
  name: string;
  email: string;
  commits: number;
  additions: number;
  deletions: number;
};

type Props = {
  contributors: ContributorRow[];
};

export function ContributorsTable({ contributors }: Props) {
  if (contributors.length === 0) {
    return <div className="text-sm text-muted-foreground">No contributors found.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="text-left py-2 pr-4 font-medium">Contributor</th>
            <th className="text-right py-2 px-3 font-medium">Commits</th>
            <th className="text-right py-2 px-3 font-medium">Additions</th>
            <th className="text-right py-2 pl-3 font-medium">Deletions</th>
          </tr>
        </thead>
        <tbody>
          {contributors.map((c) => (
            <tr key={c.email} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
              <td className="py-2 pr-4">
                <div className="font-medium truncate max-w-[180px]" title={c.name}>
                  {c.name}
                </div>
                <div className="text-xs text-muted-foreground truncate max-w-[180px]" title={c.email}>
                  {c.email}
                </div>
              </td>
              <td className="py-2 px-3 text-right tabular-nums">{formatCompact(c.commits)}</td>
              <td className="py-2 px-3 text-right tabular-nums text-green-600 dark:text-green-400">
                +{formatCompact(c.additions)}
              </td>
              <td className="py-2 pl-3 text-right tabular-nums text-red-500 dark:text-red-400">
                -{formatCompact(c.deletions)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
