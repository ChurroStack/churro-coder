import { useState } from 'react';
import { trpc } from '../../../lib/trpc';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Eye, EyeOff, Lock, Plus, Trash2, Unlock } from 'lucide-react';
import { toast } from 'sonner';

/** Mirror of the server-side env var name rule (project-env router). */
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MASK = '••••••••';

interface EnvVarRow {
  id: string;
  key: string;
  value: string;
  isProtected: boolean;
}

/**
 * Project-wide environment variables. Stored in SQLite (keyed by project, shared
 * across all worktrees) and injected into every newly spawned process —
 * terminals, Scripts runs, Claude/Codex CLIs. Protected values are encrypted at
 * rest with the OS keychain and shown masked; the eye reveals one on demand.
 *
 * Keys are immutable once created (to rename, delete and re-add) which keeps the
 * unique (project, key) constraint simple and avoids churn on every keystroke.
 */
export function EnvironmentVariablesSection({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const { data: vars } = trpc.projectEnv.list.useQuery({ projectId }, { enabled: !!projectId });

  const invalidate = () => utils.projectEnv.list.invalidate({ projectId });
  const setMutation = trpc.projectEnv.set.useMutation({
    onSuccess: invalidate,
    onError: (err) => toast.error(`Failed to save: ${err.message}`)
  });
  const removeMutation = trpc.projectEnv.remove.useMutation({
    onSuccess: invalidate,
    onError: (err) => toast.error(`Failed to delete: ${err.message}`)
  });

  // Revealed plaintext for protected rows, keyed by row id.
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  // Add-row draft.
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newProtected, setNewProtected] = useState(false);

  const reveal = async (row: EnvVarRow) => {
    if (revealed[row.id] !== undefined) {
      // Toggle hidden again.
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      return;
    }
    try {
      const res = await utils.projectEnv.reveal.fetch({ projectId, id: row.id });
      setRevealed((prev) => ({ ...prev, [row.id]: res.value }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reveal value');
    }
  };

  const saveValue = (row: EnvVarRow, value: string) => {
    if (value === (row.isProtected ? (revealed[row.id] ?? '') : row.value)) return; // unchanged
    setMutation.mutate({ projectId, key: row.key, value, isProtected: row.isProtected });
    if (row.isProtected) setRevealed((prev) => ({ ...prev, [row.id]: value }));
  };

  const toggleProtect = async (row: EnvVarRow) => {
    if (!row.isProtected) {
      // Encrypt the current (plaintext) value.
      setMutation.mutate({ projectId, key: row.key, value: row.value, isProtected: true });
      return;
    }
    // Protected → unprotected: need the plaintext to store unencrypted.
    let plaintext = revealed[row.id];
    if (plaintext === undefined) {
      try {
        const res = await utils.projectEnv.reveal.fetch({ projectId, id: row.id });
        plaintext = res.value;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to unprotect value');
        return;
      }
    }
    setMutation.mutate({ projectId, key: row.key, value: plaintext, isProtected: false });
    setRevealed((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
  };

  const addVar = () => {
    const key = newKey.trim();
    if (!key) return;
    if (!ENV_KEY_RE.test(key)) {
      toast.error('Invalid name — use letters, digits, and underscore; no leading digit');
      return;
    }
    if (vars?.some((v) => v.key === key)) {
      toast.error(`"${key}" already exists`);
      return;
    }
    setMutation.mutate(
      { projectId, key, value: newValue, isProtected: newProtected },
      {
        onSuccess: () => {
          invalidate();
          setNewKey('');
          setNewValue('');
          setNewProtected(false);
        }
      }
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <div>
          <h4 className="text-sm font-medium text-foreground mb-1">Environment Variables</h4>
          <p className="text-sm text-muted-foreground">
            Applied to every new terminal, script run, and CLI session in this project. Shared across all worktrees.
            Protected values are encrypted at rest and hidden. Changes apply to newly opened sessions.
          </p>
        </div>

        <div className="bg-background rounded-lg border border-border overflow-hidden">
          <div className="p-4 space-y-3">
            {/* Existing vars */}
            <div className="space-y-2">
              {(!vars || vars.length === 0) && (
                <p className="text-sm text-muted-foreground italic">No environment variables yet.</p>
              )}
              {vars?.map((row) => {
                const isRevealed = revealed[row.id] !== undefined;
                return (
                  <div key={row.id} className="flex items-center gap-2">
                    <span
                      className="w-40 shrink-0 truncate font-mono text-sm text-foreground"
                      title={row.key}
                      aria-label={`Variable ${row.key}`}>
                      {row.key}
                    </span>

                    {row.isProtected && !isRevealed ? (
                      <span className="flex-1 font-mono text-sm text-muted-foreground select-none" aria-hidden="true">
                        {MASK}
                      </span>
                    ) : (
                      <Input
                        defaultValue={row.isProtected ? revealed[row.id] : row.value}
                        // Remount when the displayed source value changes so the
                        // uncontrolled field can't keep showing a stale value
                        // after a server-side update (e.g. edited in another window).
                        key={`${row.id}:${isRevealed}:${row.isProtected ? '' : row.value}`}
                        onBlur={(e) => saveValue(row, e.target.value)}
                        placeholder="value"
                        aria-label={`Value of ${row.key}`}
                        className="flex-1 font-mono text-sm"
                      />
                    )}

                    {row.isProtected && (
                      <button
                        type="button"
                        className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => reveal(row)}
                        aria-label={isRevealed ? `Hide ${row.key}` : `Reveal ${row.key}`}
                        title={isRevealed ? 'Hide' : 'Reveal'}>
                        {isRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    )}

                    <button
                      type="button"
                      className={
                        'h-8 w-8 flex items-center justify-center rounded-md transition-colors ' +
                        (row.isProtected
                          ? 'text-foreground hover:text-muted-foreground'
                          : 'text-muted-foreground hover:text-foreground')
                      }
                      onClick={() => toggleProtect(row)}
                      aria-label={row.isProtected ? `Unprotect ${row.key}` : `Protect ${row.key}`}
                      title={row.isProtected ? 'Protected (encrypted) — click to unprotect' : 'Protect (encrypt)'}>
                      {row.isProtected ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                    </button>

                    <button
                      type="button"
                      className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive transition-colors"
                      onClick={() => {
                        removeMutation.mutate({ projectId, id: row.id });
                        // Drop any decrypted plaintext we were holding for this row.
                        setRevealed((prev) => {
                          const next = { ...prev };
                          delete next[row.id];
                          return next;
                        });
                      }}
                      aria-label={`Delete ${row.key}`}
                      title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Add row */}
            <div className="flex items-center gap-2 pt-1 border-t border-border/60 mt-1">
              <Input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="KEY"
                aria-label="New variable name"
                className="w-40 shrink-0 font-mono text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addVar();
                }}
              />
              <Input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="value"
                aria-label="New variable value"
                type={newProtected ? 'password' : 'text'}
                className="flex-1 font-mono text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addVar();
                }}
              />
              <button
                type="button"
                className={
                  'h-8 w-8 flex items-center justify-center rounded-md transition-colors ' +
                  (newProtected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')
                }
                onClick={() => setNewProtected((p) => !p)}
                aria-label="Protect new variable"
                aria-pressed={newProtected}
                title={newProtected ? 'Will be encrypted' : 'Stored as plaintext'}>
                {newProtected ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
              </button>
              <Button size="sm" variant="ghost" className="gap-1.5 shrink-0" onClick={addVar} disabled={!newKey.trim()}>
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
