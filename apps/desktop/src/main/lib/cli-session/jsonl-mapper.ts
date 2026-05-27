/**
 * JSONL mapper — translates a single Claude or Codex transcript line into
 * zero-or-more renderer-shaped IngestedMessages plus zero-or-more
 * IngestedSideEffects (file changes, plans, tasks).
 *
 * Cross-line correlation (tool_use ↔ tool_result, function_call ↔
 * function_call_output) is handled via a `MapperState` the caller threads
 * through every line. State is per-sub-chat (per-session-file).
 *
 * Defensive: malformed JSON is silently dropped (logged once per session via
 * the caller, not here). Unknown event types are also dropped. The mapper
 * never throws — bad lines must not poison the watermark.
 *
 * See mapping-table.ts for the declarative rules driving this code.
 */

import {
  CLAUDE_SKIP_EVENT_TYPES,
  CLAUDE_TOOL_NAME_INDEX,
  CODEX_FUNCTION_NAME_INDEX,
  CODEX_SKIP_PAYLOAD_TYPES,
  type SideEffectKind
} from './mapping-table';

export interface MessagePart {
  type: string;
  // text parts
  text?: string;
  // tool parts
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  errorText?: string;
  // session-break marker
  harness?: 'claude-cli' | 'codex-cli';
  prevSessionId?: string;
  newSessionId?: string;
}

export interface IngestedMessage {
  uuid: string;
  role: 'user' | 'assistant';
  parts: MessagePart[];
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export type IngestedSideEffect =
  | { kind: 'file-change'; path: string; action: 'create' | 'update' | 'delete' }
  | { kind: 'plan'; markdown: string; title?: string }
  | { kind: 'tasks'; tasks: unknown }
  | { kind: 'review'; markdown: string; title?: string };

export interface MapperResult {
  messages: IngestedMessage[];
  sideEffects: IngestedSideEffect[];
}

/** Per-session cross-line state. Construct once per session-file (or once per
 *  full re-scan) and reuse for every line. */
export interface MapperState {
  /** Pending tool parts keyed by call_id awaiting a tool_result /
   *  function_call_output. Stored as a shallow ref into the most recent
   *  IngestedMessage that contains them, so when the result arrives we
   *  flush the merged part out. */
  pendingTools: Map<string, MessagePart>;
}

export function createMapperState(): MapperState {
  return { pendingTools: new Map() };
}

const EMPTY: MapperResult = { messages: [], sideEffects: [] };

export function mapClaudeLine(line: string, state: MapperState): MapperResult {
  let obj: ClaudeRecord;
  try {
    obj = JSON.parse(line) as ClaudeRecord;
  } catch {
    return EMPTY;
  }
  if (!obj || typeof obj !== 'object' || typeof obj.type !== 'string') return EMPTY;
  if (CLAUDE_SKIP_EVENT_TYPES.has(obj.type)) return EMPTY;

  if (obj.type === 'assistant' || obj.type === 'user' || obj.type === 'message') {
    return mapClaudeMessageRecord(obj, state);
  }

  return EMPTY;
}

export function mapCodexLine(line: string, state: MapperState): MapperResult {
  let obj: CodexRecord;
  try {
    obj = JSON.parse(line) as CodexRecord;
  } catch {
    return EMPTY;
  }
  if (!obj || typeof obj !== 'object' || typeof obj.type !== 'string') return EMPTY;
  const payload = obj.payload && typeof obj.payload === 'object' ? obj.payload : null;
  const payloadType = payload && typeof payload.type === 'string' ? payload.type : '';

  // turn_diff is a special event we may want for file-changes in the future,
  // but the canonical source is patch_apply_end + function_call(apply_patch).
  if (obj.type === 'event_msg') {
    if (payloadType === 'patch_apply_end') return mapCodexPatchApplyEnd(payload as CodexPatchApplyEndPayload);
    if (CODEX_SKIP_PAYLOAD_TYPES.has(payloadType)) return EMPTY;
    return EMPTY;
  }

  if (obj.type === 'turn_context' || obj.type === 'session_meta') return EMPTY;

  if (obj.type === 'response_item' && payload) {
    return mapCodexResponseItem(obj, payload as CodexResponsePayload, state);
  }
  return EMPTY;
}

// ── Claude ───────────────────────────────────────────────────────────────────

interface ClaudeRecord {
  type: string;
  uuid?: string;
  leafUuid?: string;
  parentUuid?: string;
  timestamp?: string;
  message?: {
    id?: string;
    role?: string;
    content?:
      | string
      | Array<{
          type: string;
          text?: string;
          thinking?: string;
          name?: string;
          id?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: unknown;
          is_error?: boolean;
        }>;
  };
}

function mapClaudeMessageRecord(obj: ClaudeRecord, state: MapperState): MapperResult {
  const msg = obj.message;
  if (!msg) return EMPTY;
  const role = msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : null;
  if (!role) return EMPTY;

  const uuid = pickClaudeUuid(obj, msg);
  if (!uuid) return EMPTY;
  const createdAt = parseTimestamp(obj.timestamp) ?? Date.now();

  const parts: MessagePart[] = [];
  const sideEffects: IngestedSideEffect[] = [];

  const content = msg.content;
  if (typeof content === 'string') {
    if (content.trim()) parts.push({ type: 'text', text: content });
  } else if (Array.isArray(content)) {
    for (const block of content) {
      mapClaudeContentBlock(block, parts, sideEffects, state);
    }
  }

  // tool_result events for tool_uses emitted by earlier messages reach us
  // through the pendingTools side-channel. They're applied in-place to the
  // pending part there; if the result arrived alongside its tool_use in this
  // same record, mapClaudeContentBlock already merged them.

  if (parts.length === 0) return { messages: [], sideEffects };
  return {
    messages: [{ uuid, role, parts, createdAt }],
    sideEffects
  };
}

function pickClaudeUuid(obj: ClaudeRecord, msg: NonNullable<ClaudeRecord['message']>): string | null {
  if (typeof obj.uuid === 'string' && obj.uuid) return obj.uuid;
  if (typeof obj.leafUuid === 'string' && obj.leafUuid) return obj.leafUuid;
  if (typeof msg.id === 'string' && msg.id) return msg.id;
  return null;
}

function mapClaudeContentBlock(
  block: NonNullable<NonNullable<ClaudeRecord['message']>['content']> extends Array<infer T> ? T : never,
  parts: MessagePart[],
  sideEffects: IngestedSideEffect[],
  state: MapperState
): void {
  if (!block || typeof block !== 'object') return;
  switch (block.type) {
    case 'text':
      if (block.text && block.text.trim()) parts.push({ type: 'text', text: block.text });
      return;
    case 'thinking':
      if (block.thinking && block.thinking.trim()) parts.push({ type: 'reasoning', text: block.thinking });
      return;
    case 'tool_use': {
      const name = typeof block.name === 'string' ? block.name : '';
      const callId = typeof block.id === 'string' ? block.id : '';
      if (!name) return;
      const partType = `tool-${name}`;
      const part: MessagePart = {
        type: partType,
        ...(callId ? { toolCallId: callId } : {}),
        input: block.input ?? {},
        state: 'input-available'
      };
      parts.push(part);
      if (callId) state.pendingTools.set(callId, part);

      const se = extractClaudeSideEffect(name, block.input);
      if (se) sideEffects.push(...se);
      return;
    }
    case 'tool_result': {
      const targetId = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
      if (!targetId) return;
      const target = state.pendingTools.get(targetId);
      if (target) {
        target.output = block.content;
        target.state = block.is_error ? 'output-error' : 'output-available';
        state.pendingTools.delete(targetId);
      }
      // tool_result blocks themselves don't render as a separate part.
      return;
    }
    default:
      return;
  }
}

function extractClaudeSideEffect(name: string, input: unknown): IngestedSideEffect[] | null {
  const row = CLAUDE_TOOL_NAME_INDEX.get(name);
  if (!row?.sideEffect) return null;
  return materializeSideEffect(row.sideEffect, name, input);
}

// ── Codex ────────────────────────────────────────────────────────────────────

interface CodexRecord {
  type: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

interface CodexResponsePayload {
  type: string;
  id?: string;
  role?: string;
  content?: Array<{ type: string; text?: string }> | unknown;
  name?: string; // function_call name
  call_id?: string;
  arguments?: string; // JSON-stringified call args
  output?: unknown; // function_call_output
}

interface CodexPatchApplyEndPayload {
  type: 'patch_apply_end';
  call_id?: string;
  success?: boolean;
  changes?: Record<string, { kind?: 'add' | 'delete' | 'update' | string }>;
}

function mapCodexResponseItem(envelope: CodexRecord, payload: CodexResponsePayload, state: MapperState): MapperResult {
  const createdAt = parseTimestamp(envelope.timestamp) ?? Date.now();

  switch (payload.type) {
    case 'message':
      return mapCodexMessage(payload, createdAt);
    case 'reasoning':
      return mapCodexReasoning(payload, createdAt);
    case 'function_call':
    case 'custom_tool_call':
      return mapCodexFunctionCall(payload, createdAt, state);
    case 'function_call_output':
    case 'custom_tool_call_output':
      return mapCodexFunctionCallOutput(payload, state);
    default:
      return EMPTY;
  }
}

function mapCodexMessage(payload: CodexResponsePayload, createdAt: number): MapperResult {
  const role = payload.role === 'user' ? 'user' : payload.role === 'assistant' ? 'assistant' : null;
  if (!role) return EMPTY;
  const uuid = payload.id ?? null;
  if (!uuid) return EMPTY;

  const parts: MessagePart[] = [];
  if (Array.isArray(payload.content)) {
    for (const block of payload.content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'input_text' || block.type === 'output_text') {
        if (block.text && block.text.trim()) parts.push({ type: 'text', text: block.text });
      }
    }
  }
  if (parts.length === 0) return EMPTY;
  return { messages: [{ uuid, role, parts, createdAt }], sideEffects: [] };
}

function mapCodexReasoning(payload: CodexResponsePayload, createdAt: number): MapperResult {
  const uuid = payload.id ?? null;
  if (!uuid) return EMPTY;
  // Codex packs reasoning under content[].text (sometimes nested differently
  // across versions). Accept both shapes.
  let text = '';
  if (Array.isArray(payload.content)) {
    for (const block of payload.content) {
      if (block && typeof block === 'object' && typeof block.text === 'string') {
        text += (text ? '\n' : '') + block.text;
      }
    }
  } else if (typeof (payload as unknown as { text?: string }).text === 'string') {
    text = (payload as unknown as { text: string }).text;
  }
  if (!text.trim()) return EMPTY;
  return {
    messages: [{ uuid, role: 'assistant', parts: [{ type: 'reasoning', text }], createdAt }],
    sideEffects: []
  };
}

function mapCodexFunctionCall(payload: CodexResponsePayload, createdAt: number, state: MapperState): MapperResult {
  const name = payload.name ?? '';
  const callId = payload.call_id ?? '';
  if (!name) return EMPTY;
  const partType = `tool-${codexBuiltinAlias(name)}`;
  let input: unknown = {};
  if (typeof payload.arguments === 'string') {
    try {
      input = JSON.parse(payload.arguments);
    } catch {
      input = { raw: payload.arguments };
    }
  } else if (payload.arguments && typeof payload.arguments === 'object') {
    input = payload.arguments;
  }
  const part: MessagePart = {
    type: partType,
    ...(callId ? { toolCallId: callId } : {}),
    input,
    state: 'input-available'
  };
  const uuid = payload.id ?? callId ?? `${name}:${createdAt}`;

  // A function_call lands on its own response_item — wrap it as a single-part
  // assistant message.
  if (callId) state.pendingTools.set(callId, part);

  const sideEffects: IngestedSideEffect[] = [];
  const se = extractCodexSideEffect(name, input);
  if (se) sideEffects.push(...se);

  return {
    messages: [{ uuid, role: 'assistant', parts: [part], createdAt }],
    sideEffects
  };
}

function mapCodexFunctionCallOutput(payload: CodexResponsePayload, state: MapperState): MapperResult {
  const callId = payload.call_id ?? '';
  if (!callId) return EMPTY;
  const target = state.pendingTools.get(callId);
  if (!target) return EMPTY;
  target.output = payload.output;
  target.state = 'output-available';
  state.pendingTools.delete(callId);
  return EMPTY; // mutation only — the merged part already lives in a prior IngestedMessage
}

function mapCodexPatchApplyEnd(payload: CodexPatchApplyEndPayload): MapperResult {
  if (payload.success === false) return EMPTY;
  const changes = payload.changes && typeof payload.changes === 'object' ? payload.changes : {};
  const sideEffects: IngestedSideEffect[] = [];
  for (const [path, info] of Object.entries(changes)) {
    const kind = info && typeof info === 'object' ? (info as { kind?: string }).kind : undefined;
    const action: 'create' | 'update' | 'delete' = kind === 'add' ? 'create' : kind === 'delete' ? 'delete' : 'update';
    sideEffects.push({ kind: 'file-change', path, action });
  }
  return { messages: [], sideEffects };
}

function codexBuiltinAlias(name: string): string {
  // Map Codex's native tool names to the same renderer part types Claude
  // emits so the existing renderers pick them up.
  switch (name) {
    case 'exec_command':
    case 'write_stdin':
      return 'Bash';
    case 'update_plan':
      return 'TodoWrite';
    case 'view_image':
      return 'WebFetch';
    case 'apply_patch':
      return 'Edit';
    default:
      return name;
  }
}

function extractCodexSideEffect(name: string, input: unknown): IngestedSideEffect[] | null {
  const row = CODEX_FUNCTION_NAME_INDEX.get(name);
  if (!row?.sideEffect) return null;
  return materializeSideEffect(row.sideEffect, name, input);
}

// ── Side-effect materialization ─────────────────────────────────────────────

function materializeSideEffect(kind: SideEffectKind, toolName: string, input: unknown): IngestedSideEffect[] {
  const inp = (input && typeof input === 'object' ? (input as Record<string, unknown>) : {}) as Record<string, unknown>;
  switch (kind) {
    case 'file-change': {
      const path = typeof inp.file_path === 'string' ? inp.file_path : typeof inp.path === 'string' ? inp.path : '';
      if (!path) return [];
      const action: 'create' | 'update' | 'delete' =
        toolName === 'Write' || toolName === 'apply_patch' ? 'create' : 'update';
      return [{ kind: 'file-change', path, action }];
    }
    case 'plan': {
      const markdown = typeof inp.markdown === 'string' ? inp.markdown : '';
      if (!markdown) return [];
      const title = typeof inp.title === 'string' ? inp.title : undefined;
      return [{ kind: 'plan', markdown, ...(title ? { title } : {}) }];
    }
    case 'tasks': {
      // Codex update_plan: input.plan is an array.
      // MCP write_tasks: input.tasks is an array.
      const tasks = inp.tasks ?? inp.plan ?? null;
      if (tasks == null) return [];
      return [{ kind: 'tasks', tasks }];
    }
    case 'review': {
      const markdown = typeof inp.markdown === 'string' ? inp.markdown : '';
      if (!markdown) return [];
      const title = typeof inp.title === 'string' ? inp.title : undefined;
      return [{ kind: 'review', markdown, ...(title ? { title } : {}) }];
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseTimestamp(v: string | undefined): number | null {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/** Public for tests / docs generation only — re-exported for convenience. */
export { CLAUDE_TOOL_NAME_INDEX, CODEX_FUNCTION_NAME_INDEX } from './mapping-table';
