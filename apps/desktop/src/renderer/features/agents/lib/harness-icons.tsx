import { MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import claudeIcon from '../ui/icons/claude-mode.svg';
import codexIcon from '../ui/icons/codex.svg';

export type Harness = 'builtin' | 'claude-cli' | 'codex-cli';

export interface HarnessIconProps {
  harness: Harness;
  size?: number;
  className?: string;
}

/**
 * Central per-harness icon registry. Used by:
 *  - dockview tab strip (renamable-tab.tsx → ChatTabIcon)
 *  - CLI surface header badge (chat-cli-surface.tsx)
 *  - dock "New" menu entries (§7)
 *  - New Workspace wizard Agent dropdown (§8)
 *
 * Each rendered icon carries a stable `data-testid` per harness so component
 * tests can assert presence without coupling to markup structure.
 *
 * Icon mapping per specs/chat-surface-router/spec.md:
 *   builtin   → MessageSquare (matches existing idle chat tab icon)
 *   claude-cli → Claude logo (claude-mode.svg, #D97757)
 *   codex-cli  → Codex logo (codex.svg, dark:invert for theme compat)
 */
export function HarnessIcon({ harness, size = 12, className }: HarnessIconProps) {
  if (harness === 'claude-cli') {
    return (
      <img
        src={claudeIcon}
        alt="Claude CLI"
        data-testid="harness-icon-claude-cli"
        style={{ width: size, height: size }}
        className={className}
      />
    );
  }
  if (harness === 'codex-cli') {
    return (
      <img
        src={codexIcon}
        alt="Codex CLI"
        data-testid="harness-icon-codex-cli"
        style={{ width: size, height: size }}
        className={cn('dark:invert', className)}
      />
    );
  }
  // builtin — same MessageSquare used by the idle chat tab today
  return (
    <MessageSquare
      data-testid="harness-icon-builtin"
      style={{ width: size, height: size }}
      className={cn('opacity-70 flex-shrink-0', className)}
    />
  );
}

export const HARNESS_LABELS: Record<Harness, string> = {
  builtin: 'Built-in',
  'claude-cli': 'Claude CLI',
  'codex-cli': 'Codex CLI'
};
