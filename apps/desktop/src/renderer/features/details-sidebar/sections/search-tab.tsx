"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useSetAtom } from "jotai"
import { Search as SearchIcon, X as XIcon, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { trpc } from "@/lib/trpc"
import { fileViewerScrollTargetAtom } from "@/features/agents/atoms"
import { getFileIconByExtension } from "@/features/agents/mentions/agents-file-mention"

interface LineMatch {
  line: number
  col: number
  length: number
  snippet: string
}

interface FileMatches {
  path: string
  matches: LineMatch[]
}

interface SearchTabProps {
  worktreePath: string | null
  onSelectFile: (filePath: string) => void
  isActive: boolean
  className?: string
}

const MIN_QUERY_LEN = 2
const DEBOUNCE_MS = 300

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

/**
 * Renders a line snippet with the matched range highlighted. If the match
 * starts deep into a long line, prefix with an ellipsis and shift the visible
 * window so the match stays in view.
 */
function HighlightedSnippet({ snippet, col, length }: { snippet: string; col: number; length: number }) {
  const prefixCutoff = 60
  let visible = snippet
  let displayCol = col

  if (col > prefixCutoff) {
    const start = Math.max(0, col - 30)
    visible = "…" + snippet.slice(start)
    displayCol = col - start + 1 // +1 for the ellipsis we prepended
  }

  const before = visible.slice(0, displayCol)
  const matched = visible.slice(displayCol, displayCol + length)
  const after = visible.slice(displayCol + length)

  return (
    <span className="truncate">
      <span>{before}</span>
      <mark className="bg-yellow-500/30 text-foreground rounded px-0.5">{matched}</mark>
      <span>{after}</span>
    </span>
  )
}

export function SearchTab({
  worktreePath,
  onSelectFile,
  isActive,
  className,
}: SearchTabProps) {
  const [query, setQuery] = useState("")
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS)
  const [results, setResults] = useState<Map<string, LineMatch[]>>(new Map())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [scanning, setScanning] = useState(false)
  const [totalMatches, setTotalMatches] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [errored, setErrored] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset everything when query changes (or worktree changes)
  useEffect(() => {
    setResults(new Map())
    setCollapsed(new Set())
    setTotalMatches(0)
    setTruncated(false)
    setErrored(false)
  }, [debouncedQuery, worktreePath])

  // Auto-focus input when tab becomes active
  useEffect(() => {
    if (isActive) inputRef.current?.focus()
  }, [isActive])

  const subscriptionEnabled =
    isActive &&
    !!worktreePath &&
    debouncedQuery.length >= MIN_QUERY_LEN

  trpc.files.searchContent.useSubscription(
    {
      projectPath: worktreePath ?? "",
      query: debouncedQuery,
    },
    {
      enabled: subscriptionEnabled,
      onData: (batch) => {
        if (batch.files.length) {
          setResults((prev) => {
            const next = new Map(prev)
            for (const file of batch.files) {
              const existing = next.get(file.path)
              if (existing) {
                next.set(file.path, [...existing, ...file.matches])
              } else {
                next.set(file.path, file.matches)
              }
            }
            return next
          })
        }
        setTotalMatches(batch.totalMatches)
        setTruncated(batch.truncated)
        setScanning(!batch.done)
      },
      onError: () => {
        setErrored(true)
        setScanning(false)
      },
    },
  )

  // Reflect "scanning" state when a new subscription starts
  useEffect(() => {
    if (subscriptionEnabled) {
      setScanning(true)
    } else {
      setScanning(false)
    }
  }, [subscriptionEnabled])

  const toggleFileCollapsed = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const setScrollTarget = useSetAtom(fileViewerScrollTargetAtom)

  const handleResultClick = useCallback(
    (relativePath: string, line: number) => {
      if (!worktreePath) return
      const absolutePath = worktreePath + "/" + relativePath
      // Set the scroll target first so it's there when the viewer mounts/loads.
      // nonce ensures clicking the same {path, line} twice still re-scrolls.
      setScrollTarget({ path: absolutePath, line, nonce: Date.now() })
      onSelectFile(absolutePath)
    },
    [worktreePath, onSelectFile, setScrollTarget],
  )

  const fileEntries = useMemo(
    () => Array.from(results.entries()).map(([path, matches]) => ({ path, matches } as FileMatches)),
    [results],
  )

  const fileCount = fileEntries.length
  const showEmptyHint = !worktreePath
  const showTypeHint = !!worktreePath && debouncedQuery.length < MIN_QUERY_LEN
  const showNoResults =
    !!worktreePath &&
    debouncedQuery.length >= MIN_QUERY_LEN &&
    !scanning &&
    fileCount === 0 &&
    !errored

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      {/* Search input */}
      <div className="px-2 pt-1.5 pb-2 border-b border-border/50">
        <div className="relative">
          <SearchIcon className="size-3 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files…"
            spellCheck={false}
            className="w-full h-6 pl-7 pr-7 text-xs rounded-md bg-muted/50 border border-transparent focus:border-border focus:outline-none focus:bg-background"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("")
                inputRef.current?.focus()
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>

        {/* Status line */}
        {!showEmptyHint && !showTypeHint && (
          <div className="mt-1.5 text-[11px] text-muted-foreground min-h-[14px]">
            {errored
              ? "Search failed"
              : scanning && fileCount === 0
                ? "Scanning…"
                : fileCount === 0
                  ? ""
                  : `${totalMatches} ${totalMatches === 1 ? "result" : "results"} in ${fileCount} ${fileCount === 1 ? "file" : "files"}${scanning ? " · scanning…" : ""}${truncated ? " · max reached" : ""}`}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {showEmptyHint && (
          <div className="p-3 text-xs text-muted-foreground">
            Open a project to search.
          </div>
        )}
        {showTypeHint && (
          <div className="p-3 text-xs text-muted-foreground">
            Type at least {MIN_QUERY_LEN} characters to search.
          </div>
        )}
        {showNoResults && (
          <div className="p-3 text-xs text-muted-foreground">No results.</div>
        )}

        {fileEntries.map(({ path, matches }) => {
          const isCollapsed = collapsed.has(path)
          const FileIcon = getFileIconByExtension(path)
          return (
            <div key={path} className="select-none">
              <button
                type="button"
                onClick={() => toggleFileCollapsed(path)}
                className="w-full flex items-center gap-1 h-[22px] px-2 text-xs text-foreground hover:bg-accent/50"
              >
                <ChevronRight
                  className={cn(
                    "size-3 text-muted-foreground transition-transform duration-150 shrink-0",
                    !isCollapsed && "rotate-90",
                  )}
                />
                {FileIcon && <FileIcon className="size-3.5 shrink-0" />}
                <span className="truncate min-w-0 flex-1 text-left font-medium">{path}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                  {matches.length}
                </span>
              </button>
              {!isCollapsed && (
                <div>
                  {matches.map((m, idx) => (
                    <button
                      key={`${m.line}-${m.col}-${idx}`}
                      type="button"
                      onClick={() => handleResultClick(path, m.line)}
                      className="w-full flex items-baseline gap-2 h-[22px] pl-7 pr-2 text-xs text-foreground/90 hover:bg-accent/50 text-left min-w-0"
                    >
                      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 w-8 text-right">
                        {m.line}
                      </span>
                      <span className="truncate min-w-0 font-mono">
                        <HighlightedSnippet snippet={m.snippet} col={m.col} length={m.length} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
