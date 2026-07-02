import { useState, useCallback, useEffect, useMemo } from 'react';
import { useSetAtom } from 'jotai';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { trpc } from '../../lib/trpc';
import { desktopViewAtom, showNewChatFormAtom, selectedDraftIdAtom } from '../agents/atoms';
import { selectWorkspace } from '../agents/stores/sub-chat-store';
import type { WorkItem } from '../../../main/lib/work-items/types';
import { resolveIssueSessionMessage } from './session-message';

type Mode = 'plan' | 'execute' | 'explore';
type Harness = 'builtin' | 'claude-cli' | 'codex-cli';

interface StartSessionDialogProps {
  item: WorkItem | null;
  projectId: string | null;
  onClose: () => void;
}

export function StartSessionDialog({ item, projectId, onClose }: StartSessionDialogProps) {
  const [mode, setMode] = useState<Mode>('plan');
  const [harness, setHarness] = useState<Harness>('builtin');
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? '');
  const [isResolvingDetail, setIsResolvingDetail] = useState(false);

  const setDesktopView = useSetAtom(desktopViewAtom);
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom);
  const setSelectedDraftId = useSetAtom(selectedDraftIdAtom);
  const { data: projects } = trpc.projects.list.useQuery();

  useEffect(() => {
    setSelectedProjectId(projectId ?? '');
  }, [projectId, item?.id]);

  const workspaceOptions = useMemo(() => projects ?? [], [projects]);
  const needsWorkspaceSelection = !projectId;

  const createChat = trpc.chats.create.useMutation({
    onSuccess: (result) => {
      const chatId = result.id;
      if (!chatId) return;
      // Navigate to the newly created workspace
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

  const handleStart = useCallback(async () => {
    if (!item || !selectedProjectId) return;

    const name = `#${item.number}: ${item.title}`.slice(0, 100);
    setIsResolvingDetail(true);
    const initialMessage = await resolveIssueSessionMessage(item);
    setIsResolvingDetail(false);

    createChat.mutate({
      projectId: selectedProjectId,
      name,
      initialMessage,
      mode,
      harness,
      useWorktree: true
    });
  }, [item, selectedProjectId, mode, harness, createChat]);

  const isOpen = item !== null;
  const locationLabel = item ? `${item.repoOwner}/${item.repoName} #${item.number}` : '';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}>
      <DialogContent aria-label="Start session">
        <DialogHeader>
          <DialogTitle>Start session</DialogTitle>
          <DialogDescription>Choose the workspace and agent settings for this work item.</DialogDescription>
        </DialogHeader>

        {item && (
          <div className="space-y-4 py-2">
            {/* Issue summary */}
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2.5">
              <p className="text-xs text-muted-foreground mb-0.5">{locationLabel}</p>
              <p className="text-sm font-medium leading-snug">{item.title}</p>
            </div>

            {needsWorkspaceSelection && (
              <div className="space-y-1.5">
                <Label htmlFor="session-workspace">Workspace</Label>
                {workspaceOptions.length > 0 ? (
                  <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                    <SelectTrigger id="session-workspace" aria-label="Workspace">
                      <SelectValue placeholder="Select a workspace" />
                    </SelectTrigger>
                    <SelectContent>
                      {workspaceOptions.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                    No local workspaces available yet.
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  This issue is not linked to a local workspace yet. Choose one to start the session.
                </p>
              </div>
            )}

            {/* Mode */}
            <div className="space-y-1.5">
              <Label htmlFor="session-mode">Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger id="session-mode" aria-label="Session mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plan">Plan</SelectItem>
                  <SelectItem value="execute">Execute</SelectItem>
                  <SelectItem value="explore">Explore</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Harness */}
            <div className="space-y-1.5">
              <Label htmlFor="session-harness">Agent</Label>
              <Select value={harness} onValueChange={(v) => setHarness(v as Harness)}>
                <SelectTrigger id="session-harness" aria-label="Agent harness">
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
          <Button variant="outline" onClick={onClose} disabled={createChat.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleStart()}
            disabled={createChat.isPending || isResolvingDetail || !item || !selectedProjectId}
            aria-label="Confirm start session">
            {createChat.isPending || isResolvingDetail ? 'Creating…' : 'Start session'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
