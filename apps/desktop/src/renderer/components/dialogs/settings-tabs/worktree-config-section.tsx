import { useState, useEffect, useCallback, useRef } from 'react';
import { useSetAtom } from 'jotai';
import { trpc } from '../../../lib/trpc';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Plus, Trash2 } from 'lucide-react';
import { AIPenIcon } from '../../ui/icons';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../ui/select';
import { toast } from 'sonner';
import type { WorktreeScript } from '../../../../main/lib/git/worktree-config';
import { COMMAND_PROMPTS } from '../../../features/agents/commands';
import { selectedAgentChatIdAtom, selectedProjectAtom } from '../../../lib/atoms';

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
export function WorktreeConfigSection({ projectId, path }: { projectId: string; path: string }) {
  const { data: configData } = trpc.worktreeConfig.get.useQuery(
    { projectId, worktreePath: path },
    { enabled: !!projectId && !!path }
  );

  const saveMutation = trpc.worktreeConfig.save.useMutation({
    onError: (err) => {
      toast.error(`Failed to save: ${err.message}`);
    }
  });

  // "Fill with AI" creates a Local setup chat and navigates to it.
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom);
  const setSelectedProject = useSetAtom(selectedProjectAtom);
  const { data: project } = trpc.projects.get.useQuery({ id: projectId }, { enabled: !!projectId });
  const createChatMutation = trpc.chats.create.useMutation({
    onSuccess: (data) => {
      if (project) setSelectedProject(project);
      setSelectedChatId(data.id);
    }
  });

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

  const fillWithAi = (commandKey: 'worktree-setup' | 'scripts-fill', name: string) => {
    const prompt = COMMAND_PROMPTS[commandKey];
    if (prompt && projectId) {
      createChatMutation.mutate({
        projectId,
        name,
        initialMessageParts: [{ type: 'text', text: prompt }],
        useWorktree: false,
        mode: 'execute'
      });
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
              disabled={!projectId || createChatMutation.isPending}>
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
              disabled={!projectId || createChatMutation.isPending}>
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
      </div>
    </div>
  );
}
