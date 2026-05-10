/**
 * Pure helpers for working with `Chat<any>` instances + persisted message
 * payloads. Extracted from `active-chat.tsx` so the transport-factory
 * deps hook can import them without circling back through the renderer.
 *
 * Layering: pure — no React, no jotai, no tRPC. Imports only the AI SDK
 * Chat type for the structural shape.
 */

import type { Chat } from '@ai-sdk/react';

const EMPTY_PERSISTED_MESSAGES: unknown[] = [];

// Bounded LRU keyed by raw JSON string. Long Claude transcripts contain
// UTF-16 tool output that V8 stores as TwoByteStrings; re-running JSON.parse
// on the same multi-MB string from multiple components per render and across
// React Query refetches was a documented OOM trigger (renderer EXC_BREAKPOINT
// inside JsonParser::ParseJsonObject → FatalProcessOutOfMemory). The LRU lets
// every caller share one parse without unbounded growth — eviction handles
// stale strings as new sub-chat updates flow in.
const PARSE_CACHE = new Map<string, unknown[]>();
const PARSE_CACHE_MAX = 32;

function readCached(key: string): unknown[] | undefined {
  const value = PARSE_CACHE.get(key);
  if (value !== undefined) {
    PARSE_CACHE.delete(key);
    PARSE_CACHE.set(key, value);
  }
  return value;
}

function writeCached(key: string, value: unknown[]): void {
  if (PARSE_CACHE.has(key)) PARSE_CACHE.delete(key);
  PARSE_CACHE.set(key, value);
  while (PARSE_CACHE.size > PARSE_CACHE_MAX) {
    const oldestKey = PARSE_CACHE.keys().next().value;
    if (oldestKey === undefined) break;
    PARSE_CACHE.delete(oldestKey);
  }
}

/**
 * Parse the `messages` field on a sub-chat row. The DB stores it as a
 * JSON string in some code paths and as an array in others (cache vs
 * fresh fetch). This helper unifies the read.
 *
 * Returns a stable empty-array reference (`EMPTY_PERSISTED_MESSAGES`) when
 * the input is missing or unparseable, so referential-equality checks
 * downstream don't churn on every empty fetch.
 *
 * String inputs share a process-wide LRU keyed on the raw string content,
 * so multiple callers parsing the same persisted blob in one render — or
 * across short refetch ticks — only pay the JSON.parse cost once.
 */
export function parseStoredMessages(rawMessages: unknown): unknown[] {
  if (Array.isArray(rawMessages)) return rawMessages;
  if (typeof rawMessages !== 'string') return EMPTY_PERSISTED_MESSAGES;

  const cached = readCached(rawMessages);
  if (cached !== undefined) return cached;

  let parsed: unknown[];
  try {
    const result = JSON.parse(rawMessages);
    parsed = Array.isArray(result) ? result : EMPTY_PERSISTED_MESSAGES;
  } catch {
    parsed = EMPTY_PERSISTED_MESSAGES;
  }
  writeCached(rawMessages, parsed);
  return parsed;
}

/**
 * Read the `messages` field off a runtime `Chat<any>` instance. Defends
 * against a Chat that hasn't been initialized (no `messages` field) or
 * one whose messages array got replaced with a non-array via cache fudge.
 */
export function getChatMessages(chat: Chat<any> | null | undefined): unknown[] {
  const messages = (chat as { messages?: unknown } | null | undefined)?.messages;
  return Array.isArray(messages) ? messages : [];
}

/**
 * Build a `|`-separated signature of message IDs. Used both by
 * `shouldRecreateStaleRuntimeChat` (to detect divergent histories with
 * the same row count) and by `active-chat.tsx`'s persisted-hydration
 * dedupe (`persistedHydrationSignature`) — re-running the hydration is
 * skipped when the signature matches the last applied one.
 *
 * Exported so callers don't roll their own and risk drift in the join
 * format.
 */
export function messageIdSignature(messages: unknown[]): string {
  return messages.map((message) => String((message as { id?: unknown })?.id ?? '')).join('|');
}

/**
 * Decide whether the runtime Chat instance has fallen out of sync with
 * the persisted DB rows.
 *
 * Three cases trigger a recreate:
 *   1. Persisted has rows but runtime has none → cache outlived the DB
 *      (typical after optimistic create + slow DB write).
 *   2. Persisted has more rows than runtime → DB caught up; runtime is
 *      missing newer turns.
 *   3. Same row count but different ID signature → divergent histories
 *      (typically a session resume on a different machine).
 *
 * Used by the transport-factory FSM as the `isStaleRuntime` check.
 * Pure — no side effects.
 */
export function shouldRecreateStaleRuntimeChat(runtimeMessages: unknown[], persistedMessages: unknown[]): boolean {
  if (persistedMessages.length === 0) return false;
  if (runtimeMessages.length === 0) return true;
  if (persistedMessages.length > runtimeMessages.length) return true;
  return (
    persistedMessages.length === runtimeMessages.length &&
    messageIdSignature(persistedMessages) !== messageIdSignature(runtimeMessages)
  );
}
