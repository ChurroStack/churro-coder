import { useCallback, useState } from 'react';
import { useSetAtom } from 'jotai';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { trpc } from '../../lib/trpc';
import { desktopViewAtom, selectedDraftIdAtom, showNewChatFormAtom } from '../agents/atoms';
import { selectWorkspace } from '../agents/stores/sub-chat-store';
import type { WorkItem } from '../../../main/lib/work-items/types';

type Mode = 'plan' | 'execute' | 'explore';
type Harness = 'builtin' | 'claude-cli' | 'codex-cli';

interface CloneAndStartDialogProps {
  item: WorkItem | null;
  onClose: () => void;
}

export function CloneAndStartDialog({ item, onClose }: CloneAndStartDialogProps) {
  const [mode, setMode] = useState<Mode>('plan');
  const [harness, setHarness] = useState<Harness>('builtin');

  const setDesktopView = useSetAtom(desktopViewAtom);
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom);
  const setSelectedDraftId = useSetAtom(selectedDraftIdAtom);

  const createChat = trpc.chats.create.useMutation({
    onSuccess: (result) => {
      const chatId = result.id;
      if (!chatId) return;
      setDesktopView(null);
      setShowNewChatForm(false);
      setSelectedDraftId(null);
      selectWorkspace(chatId);
      onClose();
    },
    onError: (err) => {
      toast.error('Failed to create session', { description: err.message });
    }
  });

  const cloneProject = trpc.projects.cloneFromGitHub.useMutation({
    onError: (err) => {
      toast.error('Failed to clone repository', { description: err.message });
    }
  });

  const handleConfirm = useCallback(async () => {
    if (!item) return;

    const project = await cloneProject.mutateAsync({
      repoUrl: `https://github.com/${item.repoOwner}/${item.repoName}`
    });

    const name = `#${item.number}: ${item.title}`.slice(0, 100);
    const initialMessage = `I'm working on #${item.number}: ${item.title}\n\n${item.body ? item.body + '\n\n' : ''}${item.url}`;

    createChat.mutate({
      projectId: project.id,
      name,
      initialMessage,
      mode,
      harness,
      useWorktree: true
    });
  }, [cloneProject, createChat, item, mode, harness]);

  const isOpen = item !== null;
  const isPending = cloneProject.isPending || createChat.isPending;
  const locationLabel = item ? `${item.repoOwner}/${item.repoName} #${item.number}` : '';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}>
      <DialogContent aria-label="Clone and start session">
        <DialogHeader>
          <DialogTitle>Clone and start session</DialogTitle>
          <DialogDescription>
            Clone the repository into your local workspaces and create a new session with this issue as context.
          </DialogDescription>
        </DialogHeader>

        {item && (
          <div className="space-y-4 py-2">
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2.5">
              <p className="text-xs text-muted-foreground mb-0.5">{locationLabel}</p>
              <p className="text-sm font-medium leading-snug">{item.title}</p>
            </div>

            <div className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
              The repo{' '}
              <span className="font-medium text-foreground">
                {item.repoOwner}/{item.repoName}
              </span>{' '}
              is not open locally yet. MyWork will clone it first, then start a session for this issue.
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="clone-session-mode">Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger id="clone-session-mode" aria-label="Session mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plan">Plan</SelectItem>
                  <SelectItem value="execute">Execute</SelectItem>
                  <SelectItem value="explore">Explore</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="clone-session-harness">Agent</Label>
              <Select value={harness} onValueChange={(v) => setHarness(v as Harness)}>
                <SelectTrigger id="clone-session-harness" aria-label="Agent harness">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="builtin">Claude (built-in)</SelectItem>
                  <SelectItem value="claude-cli">Claude CLI</SelectItem>
                  <SelectItem value="codex-cli">Codex CLI</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleConfirm()}
            disabled={!item || isPending}
            aria-label="Confirm clone and start session">
            {isPending ? 'Working…' : 'Clone & Start'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
