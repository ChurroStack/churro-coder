// Pure parser for `<task-notification>` blocks the Claude Code harness injects
// when a background subagent comes to rest. Kept dependency-free and DOM-free so
// it can be unit-tested in plain Node. The renderer (agent-user-message-bubble)
// turns each parsed notification into a Task-style card instead of raw XML.

export interface TaskNotification {
  taskId?: string;
  agentName: string;
  status: string;
  summary: string;
  result: string;
  tokens?: number;
  toolUses?: number;
  durationMs?: number;
}

export type TaskNotificationSegment = { type: 'text'; text: string } | { type: 'notification'; data: TaskNotification };

// Match only CLOSED blocks — an unterminated `<task-notification>` (e.g. mid
// stream) must stay plain text so a half-parsed card never renders.
const BLOCK_RE = /<task-notification>([\s\S]*?)<\/task-notification>/g;

/** Cheap guard so the common case (a normal message) skips parsing entirely. */
export function hasTaskNotification(text: string): boolean {
  return text.includes('<task-notification>') && text.includes('</task-notification>');
}

// Decode only the five named XML entities the harness escapes. Deliberately NOT
// a blanket unescape, so a subagent that literally typed `&amp;` is preserved.
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractTag(source: string, tag: string): string | undefined {
  const match = source.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1] : undefined;
}

function extractNumber(source: string, tag: string): number | undefined {
  const raw = extractTag(source, tag);
  if (raw === undefined) return undefined;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : undefined;
}

function parseBlock(inner: string): TaskNotification {
  const summaryRaw = extractTag(inner, 'summary')?.trim() ?? '';
  const summary = decodeEntities(summaryRaw);
  // `Agent "Explore Project Settings & schema" came to rest` -> the quoted name.
  const nameMatch = summary.match(/Agent "(.+?)"/);
  const agentName = nameMatch ? nameMatch[1] : summary || 'Subagent';

  const usage = extractTag(inner, 'usage') ?? '';

  return {
    taskId: extractTag(inner, 'task-id')?.trim(),
    agentName,
    status: extractTag(inner, 'status')?.trim() ?? 'completed',
    summary,
    result: decodeEntities(extractTag(inner, 'result') ?? '').trim(),
    tokens: extractNumber(usage, 'subagent_tokens'),
    toolUses: extractNumber(usage, 'tool_uses'),
    durationMs: extractNumber(usage, 'duration_ms')
  };
}

/**
 * Split `text` into ordered segments of plain text and parsed notifications.
 * A message with no notification returns a single text segment (the input
 * unchanged), so callers can fall through to their normal rendering.
 */
export function parseTaskNotifications(text: string): { segments: TaskNotificationSegment[] } {
  if (!hasTaskNotification(text)) {
    return { segments: [{ type: 'text', text }] };
  }

  const segments: TaskNotificationSegment[] = [];
  let lastIndex = 0;
  BLOCK_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = BLOCK_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'notification', data: parseBlock(match[1]) });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return { segments };
}
