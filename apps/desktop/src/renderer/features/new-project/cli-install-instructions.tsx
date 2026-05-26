import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { RefreshCw, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { getPlatform } from '@/lib/utils/platform';
type ProviderId = 'github' | 'azure' | 'local';
type Platform = ReturnType<typeof getPlatform>;

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
  const [isRechecking, setIsRechecking] = useState(false);

  const { data, isFetching } = trpc.newProject.detectCli.useQuery(
    { provider, evictCache: false },
    { staleTime: 60_000 }
  );

  // The displayed query uses `evictCache:false` so the 60 s main-process cache is honored on
  // initial load. On manual Recheck we MUST evict that cache or `<cli> --version` is not
  // actually re-run — so do an imperative fetch with `evictCache:true` and push the fresh
  // result into the displayed query's cache slot. Plain `invalidate({...evictCache:true})`
  // doesn't help: React Query's refetch uses the displayed query's original input
  // (`evictCache:false`), so the backend just returns its cached negative result.
  const handleRecheck = async () => {
    setIsRechecking(true);
    try {
      const fresh = await utils.newProject.detectCli.fetch({ provider, evictCache: true });
      utils.newProject.detectCli.setData({ provider, evictCache: false }, fresh);
    } catch (err) {
      console.warn('[CliInstallInstructions] recheck failed', err);
    } finally {
      setIsRechecking(false);
    }
  };

  if (!data || data.available) return null;

  const steps = getInstallSteps(provider, getPlatform());

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
      <Button
        variant="outline"
        size="sm"
        onClick={handleRecheck}
        disabled={isFetching || isRechecking}
        className="gap-2">
        <RefreshCw className={`h-3 w-3 ${isFetching || isRechecking ? 'animate-spin' : ''}`} />
        Recheck
      </Button>
    </div>
  );
}

// Install commands per platform, sourced from each tool's official docs:
//   gh:  https://cli.github.com (winget + apt are the supported one-liners)
//   az:  https://learn.microsoft.com/en-us/cli/azure/install-azure-cli
//   git: https://git-scm.com/downloads
// Linux defaults to the Debian/Ubuntu command (largest installed base); we add
// a one-line Fedora hint as a comment so dnf users aren't left guessing.
// `unknown` falls back to the macOS commands — same as the prior hard-coded
// behavior, so this is a strict superset of the previous output.
function getInstallSteps(provider: ProviderId, platform: Platform): { summary: string; commands: string[] } {
  if (provider === 'github') {
    return {
      summary: 'GitHub CLI (gh) is not installed',
      commands: ghCommands(platform)
    };
  }
  if (provider === 'azure') {
    return {
      summary: 'Azure CLI with azure-devops extension is required',
      commands: azCommands(platform)
    };
  }
  return {
    summary: 'Git is not installed',
    commands: gitCommands(platform)
  };
}

function ghCommands(platform: Platform): string[] {
  if (platform === 'win32') return ['winget install --id GitHub.cli', 'gh auth login'];
  if (platform === 'linux') {
    return ['sudo apt install gh  # Debian/Ubuntu', '# or: sudo dnf install gh  # Fedora', 'gh auth login'];
  }
  return ['brew install gh', 'gh auth login'];
}

function azCommands(platform: Platform): string[] {
  if (platform === 'win32') {
    return ['winget install Microsoft.AzureCLI', 'az extension add --name azure-devops', 'az login'];
  }
  if (platform === 'linux') {
    return [
      'curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash',
      'az extension add --name azure-devops',
      'az login'
    ];
  }
  return ['brew install azure-cli', 'az extension add --name azure-devops', 'az login'];
}

function gitCommands(platform: Platform): string[] {
  if (platform === 'win32') return ['winget install --id Git.Git'];
  if (platform === 'linux') return ['sudo apt install git  # Debian/Ubuntu', '# or: sudo dnf install git  # Fedora'];
  return ['xcode-select --install', '# or: brew install git'];
}
