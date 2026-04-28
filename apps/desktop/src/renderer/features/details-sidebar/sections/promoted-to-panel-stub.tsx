import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

interface PromotedToPanelStubProps {
  /** Display label, e.g. "Plan" / "Terminal" / "Changes". */
  label: string
  /** Callback to close the panel and return to the summary view. */
  onReturnToSummary: () => void
}

/**
 * Placeholder rendered in the Details rail when a widget has been promoted to
 * a full dockview panel. Shows where the widget went and offers a one-click
 * way to bring it back to its summary slot.
 */
export function PromotedToPanelStub({
  label,
  onReturnToSummary,
}: PromotedToPanelStubProps) {
  return (
    <div className="mx-2 mb-2">
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-3 py-2.5 flex items-center gap-2">
        <div className="text-xs text-muted-foreground flex-1">
          <span className="font-medium text-foreground">{label}</span> is open
          as a panel
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReturnToSummary}
          className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3 mr-1" />
          Return to summary
        </Button>
      </div>
    </div>
  )
}
