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
import { stripClaudeCliEnvelopes } from '../../../shared/cli-text-envelopes';

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
  /** Owner messages whose parts were mutated by a tool_result that arrived on a
   *  *later* record than the tool_use. The owner row was already persisted (at
   *  state 'input-available'), so the caller must re-persist `parts` to land the
   *  output — otherwise the part stays output-less and renders as "interrupted".
   *  `parts` is the SAME array reference that was originally emitted (and
   *  serialized), now containing the merged part. */
  updatedMessages?: Array<{ uuid: string; parts: MessagePart[] }>;
  /** tool_result whose tool_use is no longer in `pendingTools` (its owner was
   *  persisted in a prior app session, so the in-memory ref is gone). The caller
   *  patches the persisted row by toolCallId. */
  orphanToolResults?: Array<{ toolCallId: string; output: unknown; state: 'output-available' | 'output-error' }>;
}

/** A tool part awaiting its result, plus the owner message needed to re-persist
 *  it once the result arrives on a later record. */
interface PendingTool {
  part: MessagePart;
  ownerUuid: string;
  /** The parts array of the owner IngestedMessage. `part` is an element of it;
   *  it is the exact array reference that was serialized on insert, so mutating
   *  `part` and re-persisting `ownerParts` is spill-correct. */
  ownerParts: MessagePart[];
}

/** Per-session cross-line state. Construct once per session-file (or once per
 *  full re-scan) and reuse for every line. */
export interface MapperState {
  /** Pending tool parts keyed by call_id awaiting a tool_result /
   *  function_call_output, carrying enough context to re-persist the owner row
   *  when the result lands on a later record. */
  pendingTools: Map<string, PendingTool>;
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
    if (payloadType === 'patch_apply_end')
      return mapCodexPatchApplyEnd(payload as unknown as CodexPatchApplyEndPayload);
    if (CODEX_SKIP_PAYLOAD_TYPES.has(payloadType)) return EMPTY;
    return EMPTY;
  }

  if (obj.type === 'turn_context' || obj.type === 'session_meta') return EMPTY;

  if (obj.type === 'response_item' && payload) {
    return mapCodexResponseItem(obj, payload as unknown as CodexResponsePayload, state);
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
    content?: string | ClaudeContentBlock[];
  };
  /** Record-level structured result that travels with a tool_result block (e.g.
   *  a subagent's `{agentType, totalTokens, totalToolUseCount, toolStats, content}`,
   *  Bash's `{stdout, stderr}`, Grep's `{numFiles, numLines}`). The builtin SDK
   *  path keeps the equivalent `msg.tool_use_result`; we mirror that here so the
   *  shared renderers receive the same rich object on the CLI path. */
  toolUseResult?: unknown;
}

interface ClaudeContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
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
  const updatedMessages: Array<{ uuid: string; parts: MessagePart[] }> = [];
  const orphanToolResults: Array<{ toolCallId: string; output: unknown; state: 'output-available' | 'output-error' }> =
    [];

  const content = msg.content;
  if (typeof content === 'string') {
    const stripped = role === 'user' ? stripClaudeCliEnvelopes(content) : content;
    if (stripped.trim()) parts.push({ type: 'text', text: stripped });
  } else if (Array.isArray(content)) {
    for (const block of content) {
      // Same stripping applies to text blocks inside user-message arrays —
      // some Claude Code versions wrap envelope text inside content[].text.
      if (
        role === 'user' &&
        block &&
        typeof block === 'object' &&
        block.type === 'text' &&
        typeof block.text === 'string'
      ) {
        const stripped = stripClaudeCliEnvelopes(block.text);
        if (stripped.trim()) parts.push({ type: 'text', text: stripped });
        continue;
      }
      mapClaudeContentBlock(
        block,
        parts,
        sideEffects,
        state,
        uuid,
        updatedMessages,
        orphanToolResults,
        obj.toolUseResult
      );
    }
  }

  // tool_result blocks for tool_uses emitted by EARLIER records reach us through
  // the pendingTools side-channel: mapClaudeContentBlock mutates the pending part
  // in place AND records an `updatedMessages` entry so the caller re-persists the
  // already-written owner row (the in-place mutation alone never reaches SQLite).
  // If the result arrived alongside its tool_use in THIS same record, the merge
  // happened before this message is emitted, so no update entry is produced.

  const result: MapperResult = {
    messages: parts.length === 0 ? [] : [{ uuid, role, parts, createdAt }],
    sideEffects
  };
  if (updatedMessages.length > 0) result.updatedMessages = updatedMessages;
  if (orphanToolResults.length > 0) result.orphanToolResults = orphanToolResults;
  return result;
}

function pickClaudeUuid(obj: ClaudeRecord, msg: NonNullable<ClaudeRecord['message']>): string | null {
  if (typeof obj.uuid === 'string' && obj.uuid) return obj.uuid;
  if (typeof obj.leafUuid === 'string' && obj.leafUuid) return obj.leafUuid;
  if (typeof msg.id === 'string' && msg.id) return msg.id;
  return null;
}

function mapClaudeContentBlock(
  block: ClaudeContentBlock,
  parts: MessagePart[],
  sideEffects: IngestedSideEffect[],
  state: MapperState,
  ownerUuid: string,
  updatedMessages: Array<{ uuid: string; parts: MessagePart[] }>,
  orphanToolResults: Array<{ toolCallId: string; output: unknown; state: 'output-available' | 'output-error' }>,
  /** The current record's `toolUseResult` (sibling of `message`). It always
   *  travels with the tool_result block, so it applies to whatever tool_result
   *  this record carries. */
  recordToolUseResult?: unknown
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
      // `parts` is the owner message's parts array (a stable reference shared
      // with the emitted IngestedMessage). Registering it here lets a later
      // tool_result re-persist the owner row after the in-place merge.
      if (callId) state.pendingTools.set(callId, { part, ownerUuid, ownerParts: parts });

      const se = extractClaudeSideEffect(name, block.input);
      if (se) sideEffects.push(...se);
      return;
    }
    case 'tool_result': {
      const targetId = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
      if (!targetId) return;
      const newState: 'output-available' | 'output-error' = block.is_error ? 'output-error' : 'output-available';
      // Prefer the record-level structured result when it's an object — it carries
      // the rich data (subagent toolStats/tokens, Bash stdout/stderr, …) the shared
      // renderers read via `part.output.*`. Mirrors the builtin path's
      // `output = msg.tool_use_result || block.content` (transform.ts), with one
      // deliberate addition: we keep the object on errors too (the error is already
      // carried by `state`), so an errored subagent still renders its summary.
      const richOutput =
        recordToolUseResult !== null && typeof recordToolUseResult === 'object' ? recordToolUseResult : block.content;
      const target = state.pendingTools.get(targetId);
      if (target) {
        target.part.output = richOutput;
        target.part.state = newState;
        state.pendingTools.delete(targetId);
        // Cross-record result: the owner row is already persisted, so flag it for
        // re-persistence. Same-record (owner is THIS message) needs no update —
        // the merged part will be persisted with the message itself.
        if (target.ownerUuid !== ownerUuid) {
          updatedMessages.push({ uuid: target.ownerUuid, parts: target.ownerParts });
        }
      } else {
        // No in-memory owner (tool_use persisted in a prior app session). Patch
        // the persisted row by toolCallId.
        orphanToolResults.push({ toolCallId: targetId, output: richOutput, state: newState });
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
  // assistant message. `ownerParts` is that single-element array.
  const parts = [part];
  if (callId) state.pendingTools.set(callId, { part, ownerUuid: uuid, ownerParts: parts });

  const sideEffects: IngestedSideEffect[] = [];
  const se = extractCodexSideEffect(name, input);
  if (se) sideEffects.push(...se);

  return {
    messages: [{ uuid, role: 'assistant', parts, createdAt }],
    sideEffects
  };
}

function mapCodexFunctionCallOutput(payload: CodexResponsePayload, state: MapperState): MapperResult {
  const callId = payload.call_id ?? '';
  if (!callId) return EMPTY;
  const target = state.pendingTools.get(callId);
  // Codex emits function_call and its output as separate response_items (always
  // cross-record), so a paired result must re-persist the owner row.
  if (!target) {
    return {
      messages: [],
      sideEffects: [],
      orphanToolResults: [{ toolCallId: callId, output: payload.output, state: 'output-available' }]
    };
  }
  target.part.output = payload.output;
  target.part.state = 'output-available';
  state.pendingTools.delete(callId);
  return {
    messages: [],
    sideEffects: [],
    updatedMessages: [{ uuid: target.ownerUuid, parts: target.ownerParts }]
  };
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
      // MCP write_plan uses `markdown`; Claude CLI's native ExitPlanMode uses `plan`.
      const markdown = typeof inp.markdown === 'string' ? inp.markdown : typeof inp.plan === 'string' ? inp.plan : '';
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
