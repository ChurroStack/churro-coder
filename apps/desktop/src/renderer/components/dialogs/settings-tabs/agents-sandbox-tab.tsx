import { useState, useCallback } from "react"
import { ShieldCheckIcon, ShieldAlertIcon, PlusIcon, XIcon } from "lucide-react"
import { Switch } from "../../ui/switch"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { trpc } from "../../../lib/trpc"

function CapabilityBadge({ available, label }: { available: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
        available
          ? "bg-green-500/10 text-green-600 dark:text-green-400"
          : "bg-muted text-muted-foreground"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${available ? "bg-green-500" : "bg-muted-foreground/50"}`} />
      {label}
    </span>
  )
}

function PathList({
  label,
  description,
  paths,
  onAdd,
  onRemove,
  placeholder,
}: {
  label: string
  description: string
  paths: string[]
  onAdd: (path: string) => void
  onRemove: (index: number) => void
  placeholder: string
}) {
  const [draft, setDraft] = useState("")

  const handleAdd = useCallback(() => {
    const trimmed = draft.trim()
    if (!trimmed) return
    onAdd(trimmed)
    setDraft("")
  }, [draft, onAdd])

  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
      </div>
      <div className="space-y-1.5">
        {paths.map((p, i) => (
          <div key={i} className="flex items-center gap-2 group">
            <span className="flex-1 text-xs font-mono text-foreground bg-muted px-2 py-1 rounded truncate">
              {p}
            </span>
            <button
              onClick={() => onRemove(i)}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd() }}
          placeholder={placeholder}
          className="h-7 text-xs font-mono"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleAdd}
          disabled={!draft.trim()}
          className="h-7 px-2"
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

export function AgentsSandboxTab() {
  const { data: settings, refetch: refetchSettings } = trpc.sandbox.getSettings.useQuery()
  const { data: capabilities } = trpc.sandbox.getCapabilities.useQuery()
  const setSettings = trpc.sandbox.setSettings.useMutation({ onSuccess: () => refetchSettings() })

  const globalEnabled = settings?.sandboxEnabled ?? true
  const allowToolchainCaches = settings?.allowToolchainCaches ?? true
  const osSandboxAvailable = capabilities?.osSandboxAvailable ?? false

  const extraWritable: string[] = (() => {
    try { return JSON.parse(settings?.extraWritablePaths ?? "[]") } catch { return [] }
  })()
  const extraDenied: string[] = (() => {
    try { return JSON.parse(settings?.extraDeniedPaths ?? "[]") } catch { return [] }
  })()

  const SandboxIcon = osSandboxAvailable ? ShieldCheckIcon : ShieldAlertIcon

  const updateWritable = (paths: string[]) =>
    setSettings.mutate({ extraWritablePaths: JSON.stringify(paths) })
  const updateDenied = (paths: string[]) =>
    setSettings.mutate({ extraDeniedPaths: JSON.stringify(paths) })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Sandbox</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Restrict agent file access to the current worktree and approved directories.
        </p>
      </div>

      {/* OS Sandbox status */}
      <div className="bg-background rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <SandboxIcon className={`h-4 w-4 ${osSandboxAvailable ? "text-green-500" : "text-amber-500"}`} />
          <span className="text-sm font-medium text-foreground">OS Sandbox Status</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <CapabilityBadge available={capabilities?.macSeatbelt ?? false} label="macOS Seatbelt" />
          <CapabilityBadge available={capabilities?.linuxBwrap ?? false} label="Linux bubblewrap" />
          <CapabilityBadge available={capabilities?.winNative ?? false} label="Windows native" />
        </div>
        {!osSandboxAvailable && (
          <p className="text-xs text-muted-foreground">
            OS-level sandbox is unavailable on this machine. SDK-level path enforcement is still
            active — writes outside the worktree are blocked, but Bash subprocesses are unrestricted.
          </p>
        )}
      </div>

      {/* Global sandbox toggle */}
      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <div className="space-y-0.5">
            <div className="text-sm font-medium text-foreground">Enable sandbox by default</div>
            <div className="text-xs text-muted-foreground">
              Restrict agent reads/writes to the worktree, config dirs, and approved paths.
              Per-project and per-chat overrides take precedence.
            </div>
          </div>
          <Switch
            checked={globalEnabled}
            onCheckedChange={(checked) => setSettings.mutate({ sandboxEnabled: checked })}
          />
        </div>
      </div>

      {/* Toolchain caches toggle */}
      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <div className="space-y-0.5">
            <div className="text-sm font-medium text-foreground">Allow toolchain caches</div>
            <div className="text-xs text-muted-foreground">
              Grant write access to ~/.npm, ~/.cargo, ~/.bun, ~/go/pkg/mod, and similar package caches.
            </div>
          </div>
          <Switch
            checked={allowToolchainCaches}
            onCheckedChange={(checked) => setSettings.mutate({ allowToolchainCaches: checked })}
          />
        </div>
      </div>

      {/* Extra allowed paths */}
      <div className="bg-background rounded-lg border border-border p-4 space-y-4">
        <PathList
          label="Additional allowed paths"
          description="Extra directories agents may read and write. Use ~ for home directory."
          paths={extraWritable}
          onAdd={(p) => updateWritable([...extraWritable, p])}
          onRemove={(i) => updateWritable(extraWritable.filter((_, idx) => idx !== i))}
          placeholder="~/my-project or /absolute/path"
        />
        <div className="border-t border-border" />
        <PathList
          label="Additional denied paths"
          description="Paths agents may never read, even if inside an allowed directory."
          paths={extraDenied}
          onAdd={(p) => updateDenied([...extraDenied, p])}
          onRemove={(i) => updateDenied(extraDenied.filter((_, idx) => idx !== i))}
          placeholder="~/.config/sensitive-app"
        />
      </div>

      {/* Always-allowed info */}
      <div className="bg-background rounded-lg border border-border p-4 space-y-2">
        <div className="text-sm font-medium text-foreground">Always allowed</div>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
          <li>Chat worktree or project path (read &amp; write)</li>
          <li>~/.claude, ~/.codex, ~/.churrostack (read &amp; write)</li>
          <li>$TMPDIR and /tmp (read &amp; write)</li>
          <li>~/.gitconfig, ~/.config/gh/ (read &amp; write)</li>
          {allowToolchainCaches && <li>~/.npm, ~/.cargo, ~/.bun, ~/go/pkg/mod, … (read &amp; write)</li>}
        </ul>
        <div className="text-sm font-medium text-foreground mt-3">Always denied (reads)</div>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
          <li>~/.aws/credentials</li>
          <li>~/.ssh/id_rsa, ~/.ssh/id_ed25519, ~/.ssh/id_ecdsa</li>
          <li>~/.netrc</li>
        </ul>
      </div>
    </div>
  )
}
