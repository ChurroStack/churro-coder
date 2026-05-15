import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAtom, useSetAtom } from 'jotai';
import {
  subChatStuckReasonsAtomFamily,
  subChatStuckBannerDismissedAtomFamily,
  STUCK_REASON_COPY,
  type StuckReason
} from '../atoms/stuck-detection';

interface StallIconProps {
  subChatId: string;
  /** Called when the user clicks the stall icon to expand the banner. */
  onExpand: () => void;
}

/** Stall icon indicator shown in the panel header when any heuristic is active. */
export function StallIcon({ subChatId, onExpand }: StallIconProps) {
  const stuckAtom = useMemo(() => subChatStuckReasonsAtomFamily(subChatId), [subChatId]);
  const [stuck] = useAtom(stuckAtom);

  if (stuck.size === 0) return null;

  return (
    <button
      data-testid="stall-icon"
      onClick={onExpand}
      title="Session may be stuck — click to see details"
      className="p-1 rounded text-amber-500 hover:text-amber-400 hover:bg-muted transition-colors">
      <AlertTriangle size={12} />
    </button>
  );
}

interface StallBannerProps {
  subChatId: string;
  onHardReset: () => void;
}

/** Dismissable advisory banner listing all active stuck reasons with a Hard-reset CTA. */
export function StallBanner({ subChatId, onHardReset }: StallBannerProps) {
  const stuckAtom = useMemo(() => subChatStuckReasonsAtomFamily(subChatId), [subChatId]);
  const dismissedAtom = useMemo(() => subChatStuckBannerDismissedAtomFamily(subChatId), [subChatId]);
  const [stuck] = useAtom(stuckAtom);
  const [dismissed, setDismissed] = useAtom(dismissedAtom);

  const visibleReasons = Array.from(stuck).filter((r) => !dismissed.has(r));

  if (visibleReasons.length === 0) return null;

  const dismiss = (reason: StuckReason) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(reason);
      return next;
    });
  };

  return (
    <div
      data-testid="stall-banner"
      className="flex flex-col gap-1 px-3 py-2 bg-amber-500/10 border-b border-amber-500/30 flex-shrink-0 text-xs">
      {visibleReasons.map((reason) => (
        <div key={reason} className="flex items-start justify-between gap-2">
          <span data-testid={`stall-banner-reason-${reason}`} className="text-amber-700 dark:text-amber-400 flex-1">
            {STUCK_REASON_COPY[reason]}
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onHardReset}
              className="underline text-amber-700 dark:text-amber-400 hover:opacity-80 transition-opacity">
              Hard-reset
            </button>
            <button
              data-testid={`stall-banner-dismiss-${reason}`}
              onClick={() => dismiss(reason)}
              className="text-muted-foreground hover:text-foreground transition-colors">
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
