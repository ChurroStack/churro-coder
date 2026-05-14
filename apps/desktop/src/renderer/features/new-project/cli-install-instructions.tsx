import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { RefreshCw, Copy, Check } from 'lucide-react';
import { useState } from 'react';
type ProviderId = 'github' | 'azure' | 'local';

interface Props {
  provider: ProviderId;
  missingExtension?: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} className="ml-2 text-muted-foreground hover:text-foreground">
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export function CliInstallInstructions({ provider }: Props) {
  const utils = trpc.useUtils();

  const { data, isFetching } = trpc.newProject.detectCli.useQuery(
    { provider, evictCache: false },
    { staleTime: 60_000 }
  );

  const handleRecheck = () => {
    // evictCache: true tells the procedure to drop the main-process 60 s cache before re-running.
    // invalidate() causes React Query to re-fetch, which triggers the procedure fresh.
    utils.newProject.detectCli.invalidate({ provider, evictCache: true });
  };

  if (!data || data.available) return null;

  const steps = getInstallSteps(provider);

  return (
    <div
      className="rounded-md border border-border bg-muted/40 p-4 space-y-3"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <p className="text-sm font-medium">{steps.summary}</p>
      <ol className="space-y-1">
        {steps.commands.map((cmd, i) => (
          <li key={i} className="flex items-center gap-1 font-mono text-xs text-foreground">
            <code className="flex-1 rounded bg-background px-2 py-1">{cmd}</code>
            <CopyButton text={cmd} />
          </li>
        ))}
      </ol>
      <Button variant="outline" size="sm" onClick={handleRecheck} disabled={isFetching} className="gap-2">
        <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
        Recheck
      </Button>
    </div>
  );
}

function getInstallSteps(provider: ProviderId): { summary: string; commands: string[] } {
  if (provider === 'github') {
    return {
      summary: 'GitHub CLI (gh) is not installed',
      commands: ['brew install gh', 'gh auth login']
    };
  }
  if (provider === 'azure') {
    return {
      summary: 'Azure CLI with azure-devops extension is required',
      commands: ['brew install azure-cli', 'az extension add --name azure-devops', 'az login']
    };
  }
  return {
    summary: 'Git is not installed',
    commands: ['xcode-select --install']
  };
}
