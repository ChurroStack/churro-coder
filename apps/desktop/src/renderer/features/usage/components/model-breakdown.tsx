import { useMemo, useState } from "react"
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip"
import { cn } from "../../../lib/utils"
import { formatCompact, formatUSD, formatUSDPerMTok } from "../lib/format"

type ModelRates = {
  input: number
  output: number
  cacheWrite?: number
  cacheRead?: number
}

export type ModelRow = {
  model: string
  displayName: string
  provider: "claude" | "codex" | "unknown"
  totalTokens: number
  costUSD: number
  priced: boolean
  rates: ModelRates | null
}

type Props = {
  rows: ModelRow[]
  className?: string
}

type SortKey = "model" | "price" | "tokens" | "cost"
type SortDir = "asc" | "desc"

const PROVIDER_DOT: Record<ModelRow["provider"], string> = {
  claude: "bg-[#d97757]",
  codex: "bg-emerald-500",
  unknown: "bg-muted-foreground",
}

// First-click default direction per column. Numeric columns start desc
// (highest first — what users typically want for "what's biggest"); the
// alphabetical Model column starts asc (A→Z).
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  model: "asc",
  price: "desc",
  tokens: "desc",
  cost: "desc",
}

export function sortRows(rows: ModelRow[], sortKey: SortKey, sortDir: SortDir): ModelRow[] {
  const dirMul = sortDir === "asc" ? 1 : -1
  const compare = (a: ModelRow, b: ModelRow): number => {
    if (sortKey === "model") {
      return a.displayName.localeCompare(b.displayName) * dirMul
    }
    if (sortKey === "price") {
      // Unpriced rows always sink to the end regardless of direction so the
      // visible top of the list is always meaningful.
      if (!a.rates && !b.rates) return 0
      if (!a.rates) return 1
      if (!b.rates) return -1
      return (a.rates.input - b.rates.input) * dirMul
    }
    if (sortKey === "tokens") {
      return (a.totalTokens - b.totalTokens) * dirMul
    }
    // cost: keep unpriced rows (priced=false) at the end too.
    if (a.priced !== b.priced) return a.priced ? -1 : 1
    return (a.costUSD - b.costUSD) * dirMul
  }
  return [...rows].sort(compare)
}

export function ModelBreakdown({ rows, className }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("tokens")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const maxTokens = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.totalTokens), 0),
    [rows],
  )

  const sortedRows = useMemo(
    () => sortRows(rows, sortKey, sortDir),
    [rows, sortKey, sortDir],
  )

  const handleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(nextKey)
      setSortDir(DEFAULT_DIR[nextKey])
    }
  }

  if (rows.length === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground py-6 text-center", className)}>
        No model usage recorded in this range.
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)] gap-4 text-xs text-muted-foreground font-medium py-2 border-b border-border">
        <SortHeader label="Model" align="left" sortKey="model" current={sortKey} dir={sortDir} onSort={handleSort} />
        <SortHeader label="Price ($/MTok)" align="right" sortKey="price" current={sortKey} dir={sortDir} onSort={handleSort} />
        <SortHeader label="Tokens" align="right" sortKey="tokens" current={sortKey} dir={sortDir} onSort={handleSort} />
        <SortHeader label="Cost" align="right" sortKey="cost" current={sortKey} dir={sortDir} onSort={handleSort} />
        <div>Usage</div>
      </div>
      {sortedRows.map((row) => {
        const pct = maxTokens > 0 ? (row.totalTokens / maxTokens) * 100 : 0
        return (
          <div
            key={row.model}
            className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)] gap-4 items-center py-2 text-sm border-b border-border/50 last:border-b-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={cn("w-1.5 h-1.5 rounded-full shrink-0", PROVIDER_DOT[row.provider])}
              />
              <span className="truncate" title={row.model}>
                {row.displayName}
              </span>
            </div>
            <div className="text-right tabular-nums">
              {row.rates ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-default underline decoration-dotted underline-offset-2">
                      {formatUSDPerMTok(row.rates.input)} / {formatUSDPerMTok(row.rates.output)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="min-w-36">
                    <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1">
                      <dt className="text-muted-foreground">Input</dt>
                      <dd className="text-right tabular-nums">{formatUSDPerMTok(row.rates.input)}</dd>
                      <dt className="text-muted-foreground">Output</dt>
                      <dd className="text-right tabular-nums">{formatUSDPerMTok(row.rates.output)}</dd>
                      {row.rates.cacheWrite !== undefined ? (
                        <>
                          <dt className="text-muted-foreground">Cache write</dt>
                          <dd className="text-right tabular-nums">
                            {formatUSDPerMTok(row.rates.cacheWrite)}
                          </dd>
                        </>
                      ) : null}
                      {row.rates.cacheRead !== undefined ? (
                        <>
                          <dt className="text-muted-foreground">Cache read</dt>
                          <dd className="text-right tabular-nums">
                            {formatUSDPerMTok(row.rates.cacheRead)}
                          </dd>
                        </>
                      ) : null}
                    </dl>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            <div className="text-right tabular-nums" title={row.totalTokens.toLocaleString()}>
              {formatCompact(row.totalTokens)}
            </div>
            <div className="text-right tabular-nums">
              {row.priced ? formatUSD(row.costUSD) : <span className="text-muted-foreground">—</span>}
            </div>
            <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
              <div
                className="h-full bg-foreground/70 rounded-full"
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

type SortHeaderProps = {
  label: string
  align: "left" | "right"
  sortKey: SortKey
  current: SortKey
  dir: SortDir
  onSort: (key: SortKey) => void
}

function SortHeader({ label, align, sortKey, current, dir, onSort }: SortHeaderProps) {
  const active = current === sortKey
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ChevronUp : ChevronDown
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(
        "flex items-center gap-1 font-medium hover:text-foreground transition-colors",
        align === "right" ? "justify-end" : "justify-start",
        active && "text-foreground",
      )}
    >
      <span>{label}</span>
      <Icon className={cn("h-3 w-3 shrink-0", !active && "opacity-50")} />
    </button>
  )
}
