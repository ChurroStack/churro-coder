/**
 * Read-only conversation pane for CLI sub-chats. Renders the JSONL-ingested
 * transcript using the *same* rendering pipeline the built-in chat uses, so
 * user bubbles, step-collapse, exploring-groups, tool calls, plan files and
 * MCP rich renderers all look identical to the builtin chat.
 *
 * Data flow:
 *   1) `messages.getLatest({ subChatId, limit: 200 })` pulls rows from SQLite.
 *   2) The rows are parsed (parts/metadata are JSON strings in the table) and
 *      pushed into the SAME jotai message-store the builtin chat uses, via
 *      `syncMessagesWithStatusAtom({ ..., updateGlobal: false })` so we don't
 *      clobber the currently active chat's global status / id atoms.
 *   3) `IsolatedMessagesSection` then renders the per-sub-chat user-message
 *      ids, grouping each user message with its following assistants —
 *      identical to the builtin layout.
 *
 * Live updates: subscribe to `cliSession.onMessages`; on each event invalidate
 * the latest-N query so we re-sync.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSetAtom } from 'jotai';
import { trpc } from '@/lib/trpc';
import { IsolatedMessagesSection } from '../main/isolated-messages-section';
import { FileOpenProvider } from '../mentions';
import { useOpenFileInDock } from '../../dock/use-open-file-in-dock';
import { MessageGroup } from '../components/message-group';
import { AgentToolCall } from './agent-tool-call';
import { AgentToolRegistry } from './agent-tool-registry';
import { AgentUserMessageBubble } from './agent-user-message-bubble';
import { syncMessagesWithStatusAtom } from '../stores/message-store';
import { stripClaudeCliEnvelopes } from '../../../../shared/cli-text-envelopes';
import { isAdjacentUserDup } from './cli-conversation-dedup';

interface CliConversationPaneProps {
  subChatId: string;
  chatId: string;
  sessionFileLabel?: string | null;
}

type MessageRow = {
  id: string;
  role: 'user' | 'assistant';
  parts: string | unknown[];
  metadata?: string | unknown;
};

function parseJsonField<T>(v: string | T | undefined | null, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

// The read-only CLI pane has no side-peek overlay of its own, and it always
// renders inside a dock panel, so the dock-API fallback is a no-op here.
const NO_FALLBACK = () => {};

export function CliConversationPane({ subChatId, chatId, sessionFileLabel }: CliConversationPaneProps) {
  const utils = trpc.useUtils();
  // Resolve relative paths against THIS pane's chat worktree (keyed by its own
  // chatId, not the globally active chat). Make the same file boxes / @mentions
  // clickable here as in the builtin chat, opening files in a full dockview tab.
  const { data: cliChat } = trpc.chats.get.useQuery({ id: chatId }, { enabled: !!chatId });
  const worktreePath = (cliChat?.worktreePath as string | null | undefined) ?? null;
  const openFileInDock = useOpenFileInDock(subChatId, worktreePath, NO_FALLBACK);
  const messagesQuery = trpc.messages.getLatest.useQuery(
    { subChatId, limit: 200 },
    { staleTime: 0, refetchOnWindowFocus: false }
  );

  // Live updates from the ingester.
  trpc.cliSession.onMessages.useSubscription(
    { subChatId },
    {
      onData: () => {
        utils.messages.getLatest.invalidate({ subChatId, limit: 200 });
      }
    }
  );

  const rows = (messagesQuery.data ?? []) as MessageRow[];
  const parsedMessages = useMemo(() => {
    const out = [];
    // Tracks the trimmed text of the immediately preceding *rendered* user
    // message; used to dedup the optimistic-row + JSONL-ingested duplicate
    // that older CLI subchats already have persisted in the DB. New ingestions
    // are dedup'd at the appendIngestedMessage layer (claim-merge), so this
    // is only load-bearing for historical rows.
    let lastUserText: string | null = null;
    for (const r of rows) {
      const parts = parseJsonField<unknown[]>(r.parts, []);
      const metadata = parseJsonField<Record<string, unknown> | null>(r.metadata as string | undefined, null);
      const partsArr = Array.isArray(parts) ? parts : [];
      // Render-time envelope strip for rows ingested before the mapper-side
      // strip shipped. Idempotent — a row that's already clean is unchanged.
      const cleanedParts =
        r.role === 'user'
          ? partsArr
              .map((p) => {
                if (p && typeof p === 'object' && (p as { type?: string }).type === 'text') {
                  const text = (p as { text?: unknown }).text;
                  if (typeof text === 'string') {
                    const stripped = stripClaudeCliEnvelopes(text);
                    if (!stripped.trim()) return null;
                    return { ...p, text: stripped };
                  }
                }
                return p;
              })
              .filter((p): p is unknown => p !== null)
          : partsArr;
      // Drop the whole message if stripping emptied it (all-envelope user
      // record). Otherwise the user bubble would render as an empty box.
      if (cleanedParts.length === 0) continue;
      const dup = isAdjacentUserDup({ role: r.role, parts: cleanedParts }, lastUserText);
      if (dup.dropped) continue;
      lastUserText = dup.userText;
      out.push({
        id: r.id,
        role: r.role,
        parts: cleanedParts,
        ...(metadata ? { metadata } : {})
      });
    }
    return out;
  }, [rows]);

  // Push parsed rows into the shared message-store so IsolatedMessagesSection
  // can render them with the same grouping / collapse / bubble conventions
  // the builtin chat uses. CRITICAL: updateGlobal=false — the global
  // currentSubChatId / chatStatus atoms belong to the active builtin chat
  // and must not be clobbered when a CLI pane mounts in a different window.
  const syncMessages = useSetAtom(syncMessagesWithStatusAtom);
  useEffect(() => {
    syncMessages({
      messages: parsedMessages as Parameters<typeof syncMessages>[0]['messages'],
      status: 'ready',
      subChatId,
      updateGlobal: false
    });
  }, [parsedMessages, subChatId, syncMessages]);

  // Sticky-scroll: pin to bottom unless the user has scrolled up.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
      stickyRef.current = atBottom;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    if (!stickyRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [parsedMessages.length, parsedMessages[parsedMessages.length - 1]?.id]);

  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  useEffect(() => {
    if (messagesQuery.dataUpdatedAt) setSyncedAt(messagesQuery.dataUpdatedAt);
  }, [messagesQuery.dataUpdatedAt]);
  const syncedAgo = useSyncedAgo(syncedAt);

  return (
    <div className="flex h-full w-full flex-col bg-background" data-testid="cli-conversation-pane">
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
        <div className="truncate">
          {sessionFileLabel ? (
            <>
              Reading from <span className="font-mono text-foreground/80">{sessionFileLabel}</span>
            </>
          ) : (
            <span>No CLI session detected yet</span>
          )}
        </div>
        {syncedAgo && <div className="ml-3 shrink-0">synced {syncedAgo}</div>}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto allow-text-selection">
        {parsedMessages.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {messagesQuery.isLoading
              ? 'Loading…'
              : 'No messages ingested yet. As the CLI writes its transcript, messages will appear here.'}
          </div>
        ) : (
          <div className="mx-auto w-full max-w-5xl px-2 py-4">
            <FileOpenProvider onOpenFile={openFileInDock}>
              <IsolatedMessagesSection
                subChatId={subChatId}
                chatId={chatId}
                isMobile={false}
                sandboxSetupStatus="ready"
                stickyTopClass="top-0"
                UserBubbleComponent={AgentUserMessageBubble}
                ToolCallComponent={AgentToolCall}
                MessageGroupWrapper={MessageGroup}
                toolRegistry={AgentToolRegistry}
                showContinueButton={false}
              />
            </FileOpenProvider>
          </div>
        )}
      </div>
    </div>
  );
}

function useSyncedAgo(syncedAt: number | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);
  if (!syncedAt) return null;
  const ageSec = Math.max(0, Math.floor((now - syncedAt) / 1000));
  if (ageSec < 3) return 'just now';
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  return `${Math.floor(ageSec / 3600)}h ago`;
}
