import { Component, useMemo, useState } from "react"
import type { ErrorInfo, ReactNode } from "react"
import { useAtom, useAtomValue } from "jotai"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Loader2, Search, Sparkles, FileText, LayoutGrid, Settings as SettingsIcon, AppWindow } from "lucide-react"
import { cn } from "../../lib/utils"
import { Kbd } from "../../components/ui/kbd"
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
} from "../../components/ui/command"
import { selectedAgentChatIdAtom, desktopViewAtom } from "../agents/atoms"
import { spotlightOpenAtom } from "./atoms"
import { SPOTLIGHT_PROVIDERS } from "./registry"
import type { SpotlightProviderRegistration } from "./registry"
import type { SpotlightItem, SpotlightProviderResult } from "./types"

const GROUP_ICONS: Record<string, ReactNode> = {
  suggestions: <Sparkles className="h-3 w-3" />,
  tabs: <AppWindow className="h-3 w-3" />,
  files: <FileText className="h-3 w-3" />,
  workspaces: <LayoutGrid className="h-3 w-3" />,
  settings: <SettingsIcon className="h-3 w-3" />,
}

function highlightMatch(text: string, query: string): ReactNode {
  const trimmed = query.trim()
  if (!trimmed) return text
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(escaped, "gi")
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null = regex.exec(text)
  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(
      <mark
        key={match.index}
        className="bg-primary/15 text-primary rounded-sm px-0.5 font-semibold"
      >
        {match[0]}
      </mark>,
    )
    lastIndex = match.index + match[0].length
    if (match[0].length === 0) regex.lastIndex++
    match = regex.exec(text)
  }
  if (parts.length === 0) return text
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return <>{parts}</>
}

interface ProviderRenderState {
  registration: SpotlightProviderRegistration
  result: SpotlightProviderResult
}

class ProviderErrorBoundary extends Component<
  { children: ReactNode; providerId: string },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[Spotlight] provider ${this.props.providerId} threw:`, error, info)
  }
  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

function SpotlightModalInner({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("")
  const chatId = useAtomValue(selectedAgentChatIdAtom)
  const desktopView = useAtomValue(desktopViewAtom)

  const inWorkspace = !!chatId && desktopView === null

  const providerStates: ProviderRenderState[] = SPOTLIGHT_PROVIDERS.map(
    (registration) => {
      const enabled = registration.scope === "global" || inWorkspace
      const result = registration.hook(query, enabled)
      return { registration, result }
    },
  )

  const visibleProviders = providerStates.filter(
    ({ result }) => result.items.length > 0 || result.loading,
  )

  const allEmpty =
    query.trim().length > 0 &&
    visibleProviders.length === 0 &&
    !providerStates.some(({ result }) => result.loading)

  const handleSelect = (item: SpotlightItem) => {
    onClose()
    Promise.resolve()
      .then(() => item.action())
      .catch((err) => {
        console.warn("[Spotlight] action failed:", err)
      })
  }

  return (
    <Command shouldFilter={false} className="overflow-hidden">
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Type a command or search…"
        wrapperClassName="h-11 px-3 mx-0 my-0 rounded-none bg-transparent gap-2 border-b border-border"
        className="text-sm bg-transparent"
      />
      <CommandList className="max-h-96 py-2">
        {allEmpty && (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
            <Search className="h-5 w-5 opacity-50" />
            <div className="text-sm">No results for &quot;{query}&quot;</div>
          </div>
        )}

        {visibleProviders.map(({ registration, result }, idx) => (
          <ProviderErrorBoundary
            key={registration.id}
            providerId={registration.id}
          >
            <CommandGroup
              className={cn(idx > 0 && "mt-1")}
            >
              <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground/80">
                {GROUP_ICONS[registration.id] ?? null}
                <span>{result.groupTitle}</span>
              </div>
              {result.loading && result.items.length === 0 ? (
                <div className="flex items-center gap-2 px-3 py-2 mx-1 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Searching…</span>
                </div>
              ) : (
                result.items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => handleSelect(item)}
                    className="px-3 py-2 mx-1 gap-2.5"
                  >
                    {item.icon && (
                      <span className="flex h-4 w-4 items-center justify-center text-muted-foreground shrink-0">
                        {item.icon}
                      </span>
                    )}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm font-medium truncate">
                        {highlightMatch(item.title, query)}
                      </span>
                      {item.description && (
                        <span className="text-xs text-muted-foreground truncate">
                          {highlightMatch(item.description, query)}
                        </span>
                      )}
                    </div>
                    {item.kbd && (
                      <Kbd className="ml-2 shrink-0">{item.kbd}</Kbd>
                    )}
                  </CommandItem>
                ))
              )}
            </CommandGroup>
          </ProviderErrorBoundary>
        ))}
      </CommandList>
      <div className="h-8 border-t border-border flex items-center justify-end px-3 gap-3 text-xs text-muted-foreground/70">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          <span>navigate</span>
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd>
          <span>select</span>
        </span>
        <span className="flex items-center gap-1">
          <Kbd>esc</Kbd>
          <span>close</span>
        </span>
      </div>
    </Command>
  )
}

export function SpotlightModal() {
  const [open, setOpen] = useAtom(spotlightOpenAtom)

  const handleOpenChange = useMemo(
    () => (next: boolean) => setOpen(next),
    [setOpen],
  )

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/30 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-[20%] z-50 w-[640px] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl border border-border bg-popover shadow-2xl overflow-hidden",
            "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
          }}
        >
          <DialogPrimitive.Title className="sr-only">Spotlight</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search for commands, files, workspaces, and settings
          </DialogPrimitive.Description>
          {open && <SpotlightModalInner onClose={() => setOpen(false)} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
