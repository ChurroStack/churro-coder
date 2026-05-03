"use client"

import { useState } from "react"
import { useAtom } from "jotai"
import { ArchiveRestoreIcon, Trash2Icon, SearchIcon, ArchiveXIcon } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog"
import { trpc } from "../../../lib/trpc"
import { archiveSearchQueryAtom } from "../../../lib/atoms"
import { toast } from "sonner"

interface AgentsArchivePopoverProps {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onRestoreSuccess?: (chatId: string) => void
}

export function AgentsArchivePopover({
  children,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onRestoreSuccess,
}: AgentsArchivePopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useAtom(archiveSearchQueryAtom)
  const [confirmDeleteChat, setConfirmDeleteChat] = useState<{ id: string; name: string | null } | null>(null)
  const [confirmClearAll, setConfirmClearAll] = useState(false)

  const open = controlledOpen ?? internalOpen
  const setOpen = controlledOnOpenChange ?? setInternalOpen

  const utils = trpc.useUtils()

  const { data: archivedChats = [], isLoading } = trpc.chats.listArchived.useQuery(
    {},
    { enabled: open },
  )

  const restoreMutation = trpc.chats.restore.useMutation({
    onSuccess: (chat) => {
      utils.chats.list.invalidate()
      utils.chats.listArchived.invalidate()
      if (chat) {
        onRestoreSuccess?.(chat.id)
        toast.success("Workspace restored")
      }
    },
    onError: () => toast.error("Failed to restore workspace"),
  })

  const deleteMutation = trpc.chats.delete.useMutation({
    onSuccess: () => {
      utils.chats.listArchived.invalidate()
      toast.success("Workspace deleted permanently")
    },
    onError: () => toast.error("Failed to delete workspace"),
  })

  const deleteAllMutation = trpc.chats.deleteAllArchived.useMutation({
    onSuccess: (result) => {
      utils.chats.listArchived.invalidate()
      toast.success(`Cleared ${result.deleted} archived workspace${result.deleted === 1 ? "" : "s"}`)
    },
    onError: () => toast.error("Failed to clear archive"),
  })

  const filtered = archivedChats.filter((c) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (c.name ?? "Untitled workspace").toLowerCase().includes(q)
  })

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={6}
          className="w-72 p-0 flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
            <span className="text-xs font-medium text-foreground">Archived workspaces</span>
            {archivedChats.length > 0 && (
              <button
                type="button"
                onClick={() => setConfirmClearAll(true)}
                disabled={deleteAllMutation.isPending}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
              >
                <Trash2Icon className="h-3 w-3" />
                Clear all
              </button>
            )}
          </div>

          {/* Search */}
          {archivedChats.length > 0 && (
            <div className="relative px-3 py-2 border-b border-border/50">
              <SearchIcon className="absolute left-5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Search archive…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-5 pr-2 py-0.5 text-xs bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
              />
            </div>
          )}

          {/* List */}
          <div className="overflow-y-auto max-h-64">
            {isLoading && (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                Loading…
              </div>
            )}

            {!isLoading && archivedChats.length === 0 && (
              <div className="flex flex-col items-center gap-1.5 px-3 py-6 text-center">
                <ArchiveXIcon className="h-5 w-5 text-muted-foreground/50" />
                <span className="text-xs text-muted-foreground">No archived workspaces</span>
              </div>
            )}

            {!isLoading && archivedChats.length > 0 && filtered.length === 0 && (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                No results
              </div>
            )}

            {filtered.map((chat) => (
              <div
                key={chat.id}
                className="flex items-center gap-1 px-3 py-1.5 hover:bg-muted/50 group"
              >
                <span className="flex-1 truncate text-xs text-foreground">
                  {chat.name ?? "Untitled workspace"}
                </span>
                <button
                  type="button"
                  onClick={() => restoreMutation.mutate({ id: chat.id })}
                  disabled={restoreMutation.isPending}
                  className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                  title="Restore workspace"
                >
                  <ArchiveRestoreIcon className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteChat(chat)}
                  disabled={deleteMutation.isPending}
                  className="shrink-0 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                  title="Delete permanently"
                >
                  <Trash2Icon className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <AlertDialog
        open={confirmDeleteChat !== null}
        onOpenChange={(open) => { if (!open) setConfirmDeleteChat(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">
                {confirmDeleteChat?.name ?? "Untitled workspace"}
              </span>{" "}
              will be deleted forever. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!confirmDeleteChat) return
                deleteMutation.mutate({ id: confirmDeleteChat.id, deleteWorktree: true })
                setConfirmDeleteChat(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmClearAll}
        onOpenChange={setConfirmClearAll}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all archived workspaces?</AlertDialogTitle>
            <AlertDialogDescription>
              All {archivedChats.length} archived workspace
              {archivedChats.length === 1 ? "" : "s"} will be deleted forever, along
              {" "}with their worktrees on disk. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                deleteAllMutation.mutate()
                setConfirmClearAll(false)
              }}
            >
              Clear all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
