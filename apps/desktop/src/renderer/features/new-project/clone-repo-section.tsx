import { useState } from 'react';
import { useSetAtom } from 'jotai';
import { trpc } from '@/lib/trpc';
import { newProjectDialogOpenAtom } from './atoms';
import { useApplyAddedProject } from './use-apply-added-project';
import { parseAzureDevOpsRef } from '../../../shared/git-url-parsers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

export function CloneRepoSection() {
  const [url, setUrl] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const setDialogOpen = useSetAtom(newProjectDialogOpenAtom);
  const applyAddedProject = useApplyAddedProject();

  const clone = trpc.projects.cloneFromGitHub.useMutation({
    onSuccess: (project) => {
      if (project) {
        applyAddedProject(project);
        setDialogOpen(false);
      }
    }
  });

  const validate = (value: string): boolean => {
    if (!value.trim()) {
      setParseError('Enter a repository URL or owner/repo');
      return false;
    }
    // GitHub or short format
    if (/github\.com|^[^/\s]+\/[^/\s]+$|^git@/.test(value)) {
      setParseError(null);
      return true;
    }
    // Azure DevOps
    const azure = parseAzureDevOpsRef(value);
    if (azure) {
      setParseError(null);
      return true;
    }
    setParseError('Enter a GitHub URL (owner/repo or https://github.com/...) or Azure DevOps URL');
    return false;
  };

  const handleClone = () => {
    if (!validate(url)) return;
    clone.mutate({ repoUrl: url });
  };

  return (
    <div className="space-y-4 py-4" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <p className="text-sm text-muted-foreground">Clone an existing GitHub or Azure DevOps repository.</p>
      <div className="space-y-1">
        <Input
          placeholder="owner/repo, https://github.com/..., or https://dev.azure.com/org/project/_git/repo"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setParseError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleClone()}
        />
        {parseError && <p className="text-xs text-destructive">{parseError}</p>}
        {clone.error && <p className="text-xs text-destructive">{clone.error.message}</p>}
      </div>
      <Button onClick={handleClone} disabled={clone.isPending || !url.trim()} className="gap-2">
        {clone.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        Clone repository
      </Button>
    </div>
  );
}
