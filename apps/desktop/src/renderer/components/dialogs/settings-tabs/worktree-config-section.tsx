import { useState, useEffect, useCallback, useRef } from 'react';
import { trpc, trpcClient } from '../../../lib/trpc';
import { api } from '../../../lib/mock-api';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Plus, Trash2 } from 'lucide-react';
import { AIPenIcon } from '../../ui/icons';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../ui/select';
import { toast } from 'sonner';
import type { WorktreeScript } from '../../../../main/lib/git/worktree-config';
import { COMMAND_PROMPTS } from '../../../features/agents/commands';
import { selectWorkspace, useAgentSubChatStore } from '../../../features/agents/stores/sub-chat-store';
import { ConfirmDeleteDialog } from '../../confirm-delete-dialog';

/**
 * Worktree config (setup commands + scripts + config-file target + "Fill with
 * AI"), scoped to `path` — the workspace's own working tree. Reads/writes via
 * the worktreeConfig router with `worktreePath: path`, so edits land in that
 * tree's `.cscode/worktree.json` (or `.cursor/worktrees.json`) and ride along
 * with the branch — not the base repo.
 *
 * Extracted from the former global Projects tab (`agents-project-worktree-tab`),
 * minus the project-level General / Danger Zone sections (name/icon/remove live
 * in the project kebab menu).
 */
export function WorktreeConfigSection({
  projectId,
  path,
  chatId
}: {
  projectId: string;
  path: string;
  chatId: string;
}) {
  const { data: configData } = trpc.worktreeConfig.get.useQuery(
    { projectId, worktreePath: path },
    { enabled: !!projectId && !!path }
  );

  const saveMutation = trpc.worktreeConfig.save.useMutation({
    onError: (err) => {
      toast.error(`Failed to save: ${err.message}`);
    }
  });

  // "Fill with AI" opens a new sub-chat *inside this workspace* (chatId) so the
  // agent runs in the workspace's own worktree — which the chat row already owns
  // via worktreePath — and its generated config lands in the same tree this panel
  // reads/writes. Creating a new top-level chat would instead run in the project
  // root (Local workspace). See the per-workspace settings plan.
  const utils = api.useUtils();

  const [saveTarget, setSaveTarget] = useState<'cursor' | 'cscode'>('cscode');
  const [commands, setCommands] = useState<string[]>(['']);
  const [unixCommands, setUnixCommands] = useState<string[]>([]);
  const [windowsCommands, setWindowsCommands] = useState<string[]>([]);
  const [showPlatformSpecific, setShowPlatformSpecific] = useState(false);
  const [scripts, setScripts] = useState<WorktreeScript[]>([]);

  const savedConfigRef = useRef<string>('');
  const configReadyRef = useRef(false);

  // Sync from server data
  useEffect(() => {
    if (!configData) return;
    const newSaveTarget = configData.source === 'cursor' ? 'cursor' : 'cscode';
    setSaveTarget(newSaveTarget);

    let newCommands: string[] = [''];
    let newUnix: string[] = [];
    let newWin: string[] = [];
    let newScripts: WorktreeScript[] = [];

    if (configData.config) {
      const isComment = (s: string) => s.trimStart().startsWith('#');
      const filterComments = (arr: string[]) => arr.filter((s) => !isComment(s));

      const generic = configData.config['setup-worktree'];
      const genericArr = Array.isArray(generic)
        ? filterComments(generic)
        : generic && !isComment(generic)
          ? [generic]
          : [];
      newCommands = genericArr.length > 0 ? [...genericArr, ''] : [''];

      const unix = configData.config['setup-worktree-unix'];
      const win = configData.config['setup-worktree-windows'];

      newUnix = Array.isArray(unix) ? filterComments(unix) : unix && !isComment(unix) ? [unix] : [];
      newWin = Array.isArray(win) ? filterComments(win) : win && !isComment(win) ? [win] : [];

      if (unix || win) setShowPlatformSpecific(true);

      if (Array.isArray(configData.config.scripts)) {
        newScripts = configData.config.scripts;
      }
    }

    setCommands(newCommands);
    setUnixCommands(newUnix);
    setWindowsCommands(newWin);
    setScripts(newScripts);

    savedConfigRef.current = JSON.stringify({
      commands: newCommands,
      unixCommands: newUnix,
      windowsCommands: newWin,
      scripts: newScripts,
      saveTarget: newSaveTarget
    });
    configReadyRef.current = true;
  }, [configData]);

  const doSave = useCallback(() => {
    if (!projectId || !configReadyRef.current) return;

    const currentState = JSON.stringify({ commands, unixCommands, windowsCommands, scripts, saveTarget });
    if (currentState === savedConfigRef.current) return;

    const config: Record<string, unknown> = {};
    const filteredCommands = commands.filter((c) => c.trim());
    const filteredUnix = unixCommands.filter((c) => c.trim());
    const filteredWin = windowsCommands.filter((c) => c.trim());

    if (filteredCommands.length > 0) config['setup-worktree'] = filteredCommands;
    if (filteredUnix.length > 0) config['setup-worktree-unix'] = filteredUnix;
    if (filteredWin.length > 0) config['setup-worktree-windows'] = filteredWin;

    const trimmed = scripts
      .map((s) => ({ name: s.name.trim(), command: s.command.trim() }))
      .filter((s) => s.name && s.command);
    const seen = new Set<string>();
    const uniq: WorktreeScript[] = [];
    for (const s of trimmed) {
      if (seen.has(s.name)) {
        toast.error(`Duplicate script name: "${s.name}" — keeping the first one`);
        continue;
      }
      seen.add(s.name);
      uniq.push(s);
    }
    if (uniq.length > 0) config.scripts = uniq;

    saveMutation.mutate({
      projectId,
      worktreePath: path,
      config: config as Parameters<typeof saveMutation.mutate>[0]['config'],
      target: saveTarget
    });
    savedConfigRef.current = currentState;
  }, [projectId, path, commands, unixCommands, windowsCommands, scripts, saveTarget, saveMutation]);

  const updateCommand = (index: number, value: string, list: string[], setter: (v: string[]) => void) => {
    const newList = [...list];
    newList[index] = value;
    setter(newList);
  };

  const pendingSaveRef = useRef(false);

  const removeCommand = (index: number, list: string[], setter: (v: string[]) => void, allowEmpty = false) => {
    if (!allowEmpty && list.length <= 1) return;
    setter(list.filter((_, i) => i !== index));
    pendingSaveRef.current = true;
  };

  // Save after state updates from remove or saveTarget change
  useEffect(() => {
    if (pendingSaveRef.current) {
      pendingSaveRef.current = false;
      doSave();
    }
  }, [commands, unixCommands, windowsCommands, scripts, saveTarget, doSave]);

  const addCommand = (list: string[], setter: (v: string[]) => void) => {
    setter([...list, '']);
  };

  const updateScriptField = (index: number, field: 'name' | 'command', value: string) => {
    setScripts((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  };

  const removeScript = (index: number) => {
    setScripts((prev) => prev.filter((_, i) => i !== index));
    pendingSaveRef.current = true;
  };

  const addScript = () => {
    setScripts((prev) => [...prev, { name: '', command: '' }]);
  };

  const cursorExists = configData?.available?.cursor?.exists ?? false;

  const [isFilling, setIsFilling] = useState(false);

  // ── Branch cleanup ──
  // Deletes local branches whose remote branch has been deleted (upstream is
  // [gone] after a prune) — e.g. after a merged PR. Never-pushed local branches
  // are kept. Repo-global: it operates on the whole repository even though this
  // panel is workspace-scoped; active workspace branches are protected server-side.
  const cleanBranchesMutation = trpc.changes.cleanBranchesWithoutRemote.useMutation();
  const [orphanCandidates, setOrphanCandidates] = useState<string[] | null>(null);

  const scanOrphanBranches = async () => {
    try {
      const res = await cleanBranchesMutation.mutateAsync({ worktreePath: path, dryRun: true });
      if (!res.hasRemote) {
        toast.info('This repository has no remote configured');
        return;
      }
      if (res.candidates.length === 0) {
        toast.info('No orphaned branches to clean');
        return;
      }
      setOrphanCandidates(res.candidates);
    } catch (err) {
      toast.error(`Failed to scan branches: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const confirmCleanOrphanBranches = async () => {
    try {
      const res = await cleanBranchesMutation.mutateAsync({ worktreePath: path, dryRun: false });
      toast.success(`Deleted ${res.deleted.length} branch${res.deleted.length === 1 ? '' : 'es'}`);
    } catch (err) {
      toast.error(`Failed to clean branches: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setOrphanCandidates(null);
    }
  };

  const fillWithAi = async (commandKey: 'worktree-setup' | 'scripts-fill', name: string) => {
    const prompt = COMMAND_PROMPTS[commandKey];
    if (!prompt || !chatId || isFilling) return;

    setIsFilling(true);
    const newSubChatId = crypto.randomUUID();
    try {
      // Seed + persist the prompt as the new sub-chat's first user message. The
      // sub-chat inherits this workspace's worktreePath, so the agent runs in the
      // displayed tree. On open, the chat surface hydrates the seeded message and
      // auto-sends it (same path as `chats.create`).
      await trpcClient.chats.createSubChat.mutate({
        id: newSubChatId,
        chatId,
        name,
        mode: 'execute',
        initialMessageParts: [{ type: 'text', text: prompt }]
      });

      // Navigate this window to the workspace + new sub-chat. selectWorkspace is
      // the single entry point that keeps the store's chatId and the selected-chat
      // atom in sync; switching first makes store.chatId === chatId so the
      // cross-workspace guards on the store mutations below pass.
      const store = useAgentSubChatStore.getState();
      if (store.chatId !== chatId) selectWorkspace(chatId);
      useAgentSubChatStore.getState().addToOpenSubChats(newSubChatId, chatId);
      useAgentSubChatStore.getState().setActiveSubChat(newSubChatId, chatId);

      // Refetch so the chat surface sees the new sub-chat (tab validity) and its
      // seeded message (which drives the auto-send on open).
      void utils.agents.getAgentChat.invalidate({ chatId });
    } catch (err) {
      console.error('[worktree-config] Fill with AI failed', err);
      toast.error('Failed to start Fill with AI');
    } finally {
      setIsFilling(false);
    }
  };

  const renderCommandList = (
    list: string[],
    setter: (v: string[]) => void,
    placeholder: string,
    allowEmpty = false
  ) => (
    <div className="space-y-2">
      {list.map((cmd, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={cmd}
            onChange={(e) => updateCommand(i, e.target.value, list, setter)}
            onBlur={doSave}
            placeholder={placeholder}
            className="flex-1 font-mono text-sm"
          />
          {(allowEmpty || list.length > 1) && (
            <button
              type="button"
              className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive transition-colors"
              onClick={() => removeCommand(i, list, setter, allowEmpty)}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => addCommand(list, setter)}>
        <Plus className="h-3.5 w-3.5" />
        Add command
      </button>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        {/* ── Config ── */}
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">Config</h4>
          <div className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="flex items-center justify-between p-4">
              <div className="flex-1">
                <span className="text-sm font-medium text-foreground">Config file</span>
                <p className="text-sm text-muted-foreground">Where worktree setup is stored (in this working tree)</p>
              </div>
              <Select
                value={saveTarget}
                onValueChange={(v) => {
                  setSaveTarget(v as 'cursor' | 'cscode');
                  pendingSaveRef.current = true;
                }}>
                <SelectTrigger className="w-auto px-3">
                  <span className="text-sm font-mono">
                    {saveTarget === 'cursor' ? '.cursor/worktrees.json' : '.cscode/worktree.json'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cscode">.cscode/worktree.json</SelectItem>
                  {cursorExists && <SelectItem value="cursor">.cursor/worktrees.json</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* ── Worktree ── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-foreground">Worktree</h4>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={() => fillWithAi('worktree-setup', 'Worktree Setup')}
              disabled={!chatId || isFilling}>
              <AIPenIcon className="h-3.5 w-3.5" />
              Fill with AI
            </Button>
          </div>
          <div className="bg-background rounded-lg border border-border overflow-hidden">
            {/* Setup commands */}
            <div className="p-4 space-y-3">
              <div>
                <span className="text-sm font-medium text-foreground">Setup Commands</span>
                <p className="text-sm text-muted-foreground">
                  Run after worktree creation.{' '}
                  <button
                    type="button"
                    className="font-mono text-xs bg-muted px-1 py-0.5 rounded hover:text-foreground transition-colors cursor-pointer"
                    onClick={() => {
                      navigator.clipboard.writeText('$ROOT_WORKTREE_PATH');
                      toast.success('Copied to clipboard');
                    }}
                    title="Click to copy">
                    $ROOT_WORKTREE_PATH
                  </button>{' '}
                  for main repo.
                </p>
              </div>
              {renderCommandList(commands, setCommands, 'bun install && cp $ROOT_WORKTREE_PATH/.env .env')}
            </div>

            {/* Platform overrides — macOS/Linux */}
            {(unixCommands.length > 0 || showPlatformSpecific) && (
              <div className="p-4 border-t border-border space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">macOS / Linux</span>
                  {unixCommands.length === 0 && (
                    <span className="text-sm text-muted-foreground">Falls back to commands above</span>
                  )}
                </div>
                {renderCommandList(unixCommands, setUnixCommands, 'brew install deps', true)}
              </div>
            )}

            {/* Platform overrides — Windows */}
            {(windowsCommands.length > 0 || showPlatformSpecific) && (
              <div className="p-4 border-t border-border space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">Windows</span>
                  {windowsCommands.length === 0 && (
                    <span className="text-sm text-muted-foreground">Falls back to commands above</span>
                  )}
                </div>
                {renderCommandList(windowsCommands, setWindowsCommands, 'npm ci', true)}
              </div>
            )}

            {/* Add platform overrides link */}
            {!showPlatformSpecific && unixCommands.length === 0 && windowsCommands.length === 0 && (
              <div className="p-4 border-t border-border">
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPlatformSpecific(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Add platform-specific overrides
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Scripts ── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-foreground">Scripts</h4>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={() => fillWithAi('scripts-fill', 'Scripts')}
              disabled={!chatId || isFilling}>
              <AIPenIcon className="h-3.5 w-3.5" />
              Fill with AI
            </Button>
          </div>
          <div className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="p-4 space-y-3">
              <div>
                <span className="text-sm font-medium text-foreground">Runnable scripts</span>
                <p className="text-sm text-muted-foreground">
                  Each script appears in the Scripts widget with a Run/Stop button. Names must be unique.
                </p>
              </div>
              <div className="space-y-2">
                {scripts.length === 0 && <p className="text-sm text-muted-foreground italic">No scripts yet.</p>}
                {scripts.map((script, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={script.name}
                      onChange={(e) => updateScriptField(i, 'name', e.target.value)}
                      onBlur={doSave}
                      placeholder="dev"
                      className="w-32 font-mono text-sm"
                    />
                    <Input
                      value={script.command}
                      onChange={(e) => updateScriptField(i, 'command', e.target.value)}
                      onBlur={doSave}
                      placeholder="bun run dev"
                      className="flex-1 font-mono text-sm"
                    />
                    <button
                      type="button"
                      className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive transition-colors"
                      onClick={() => removeScript(i)}
                      aria-label={`Remove ${script.name || 'script'}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={addScript}>
                <Plus className="h-3.5 w-3.5" />
                Add script
              </button>
            </div>
          </div>
        </div>

        {/* ── Branch cleanup ── */}
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">Branch cleanup</h4>
          <div className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="flex items-center justify-between p-4">
              <div className="flex-1 pr-4">
                <span className="text-sm font-medium text-foreground">Clean orphaned branches</span>
                <p className="text-sm text-muted-foreground">
                  Delete local branches whose remote branch has been deleted (e.g. after a merged PR). Never-pushed
                  local branches are kept. Applies to the whole repository; active workspace branches are kept.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={scanOrphanBranches}
                disabled={cleanBranchesMutation.isPending}>
                Clean orphaned branches
              </Button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDeleteDialog
        open={orphanCandidates !== null}
        onOpenChange={(open) => {
          if (!open) setOrphanCandidates(null);
        }}
        title="Clean orphaned branches"
        description={`The following ${orphanCandidates?.length ?? 0} local branch${
          orphanCandidates?.length === 1 ? '' : 'es'
        } no longer ${orphanCandidates?.length === 1 ? 'has' : 'have'} a remote branch and will be permanently deleted:`}
        warning={
          <>
            <ul className="mt-2 max-h-48 overflow-y-auto list-disc pl-5 font-mono text-xs">
              {orphanCandidates?.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <p className="text-sm text-destructive mt-2">This action cannot be undone.</p>
          </>
        }
        confirmLabel="Delete branches"
        onConfirm={confirmCleanOrphanBranches}
        isDeleting={cleanBranchesMutation.isPending}
      />
    </div>
  );
}
