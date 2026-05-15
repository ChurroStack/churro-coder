import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';

export type StuckReason = 'pty-early-exit' | 'pty-silence' | 'mcp-5xx' | 'stream-silence';

export const STUCK_REASON_COPY: Record<StuckReason, string> = {
  'pty-early-exit': 'The CLI process exited unexpectedly within 5 seconds of starting.',
  'pty-silence': 'The CLI has been silent for over 60 seconds.',
  'mcp-5xx': 'The MCP server returned three consecutive errors.',
  'stream-silence': 'The agent stream has been silent for over 2 minutes during a tool call.'
};

/** Active stuck reasons per subChat. Written by detection hooks. */
export const subChatStuckReasonsAtomFamily = atomFamily((_subChatId: string) =>
  atom<ReadonlySet<StuckReason>>(new Set<StuckReason>())
);

/** Reasons whose per-reason banner has been dismissed. Stall icon stays visible. */
export const subChatStuckBannerDismissedAtomFamily = atomFamily((_subChatId: string) =>
  atom<ReadonlySet<StuckReason>>(new Set<StuckReason>())
);

/** Hard-reset handler registered by the owning builtin-harness panel. null = CLI harness (handles reset internally). */
export const subChatHardResetHandlerAtomFamily = atomFamily((_subChatId: string) =>
  atom<(() => Promise<void>) | null>(null)
);
