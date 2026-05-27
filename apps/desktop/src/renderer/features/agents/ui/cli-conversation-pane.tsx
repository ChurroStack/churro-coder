/**
 * Read-only conversation pane for CLI sub-chats. Renders the JSONL-ingested
 * transcript using the same AssistantMessageItem the built-in agent uses, so
 * tool calls, plan files, MCP calls, thinking blocks etc. render identically.
 *
 * Data flow:
 *   1) Initial fetch: `messages.getLatest({ subChatId, limit: 200 })`.
 *   2) Live updates: subscribe to `cliSession.onMessages({ subChatId })` —
 *      the server-side observable fires after every ingester batch. On
 *      receive, refetch the latest tail.
 *
 * Sticky-scroll: pin to the bottom unless the user has scrolled up. Mirror of
 * the built-in chat panel pattern but inlined (the existing hook is tightly
 * coupled to the live agent stream).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { AssistantMessageItem } from '../main/assistant-message-item';

interface CliConversationPaneProps {
  subChatId: string;
  chatId: string;
  sessionFileLabel?: string | null;
}

// Raw row shape from messages.getLatest (drizzle select() — JSON columns are
// returned as strings, NOT parsed). parts/metadata must be JSON.parse'd before
// the renderer can consume them.
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

export function CliConversationPane({ subChatId, chatId, sessionFileLabel }: CliConversationPaneProps) {
  const utils = trpc.useUtils();
  const messagesQuery = trpc.messages.getLatest.useQuery(
    { subChatId, limit: 200 },
    { staleTime: 0, refetchOnWindowFocus: false }
  );

  // Live updates from the ingester. tRPC React exposes subscriptions via
  // .useSubscription() — the bare .subscribe() lives only on the vanilla
  // client. Calling .subscribe() inside a useEffect raises "hooks[lastArg]
  // is not a function" because React's hook proxy can't bind it.
  trpc.cliSession.onMessages.useSubscription(
    { subChatId },
    {
      onData: () => {
        utils.messages.getLatest.invalidate({ subChatId, limit: 200 });
      }
    }
  );

  const rows = (messagesQuery.data ?? []) as MessageRow[];
  const messageObjects = useMemo(
    () =>
      rows.map((r) => {
        const parts = parseJsonField<unknown[]>(r.parts, []);
        const metadata = parseJsonField<Record<string, unknown> | null>(r.metadata as string | undefined, null);
        return {
          id: r.id,
          role: r.role,
          parts: Array.isArray(parts) ? parts : [],
          ...(metadata ? { metadata } : {})
        };
      }),
    [rows]
  );

  // Sticky-scroll: pin to bottom unless user scrolled up.
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
  }, [messageObjects.length, messageObjects[messageObjects.length - 1]?.id]);

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
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messageObjects.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {messagesQuery.isLoading
              ? 'Loading…'
              : 'No messages ingested yet. As the CLI writes its transcript, messages will appear here.'}
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-4 py-4">
            {messageObjects.map((m, i) => (
              <AssistantMessageItem
                key={`${m.id}:${i}`}
                message={m}
                isLastMessage={i === messageObjects.length - 1}
                isStreaming={false}
                status="ready"
                isMobile={false}
                subChatId={subChatId}
                chatId={chatId}
              />
            ))}
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
