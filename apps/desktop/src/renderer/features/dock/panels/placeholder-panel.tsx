import type { IDockviewPanelProps } from "dockview-react"

export function PlaceholderPanel({ api, params }: IDockviewPanelProps) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-2 p-6 text-muted-foreground">
      <div className="text-sm font-medium">Panel scaffolded</div>
      <div className="text-xs">id: {api.id}</div>
      {params && Object.keys(params).length > 0 ? (
        <pre className="text-[11px] bg-muted rounded px-2 py-1 max-w-full overflow-auto">
          {JSON.stringify(params, null, 2)}
        </pre>
      ) : null}
    </div>
  )
}
