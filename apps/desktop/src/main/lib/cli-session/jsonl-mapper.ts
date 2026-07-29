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

import { createHash } from 'node:crypto';
import {
  CLAUDE_SKIP_EVENT_TYPES,
  CLAUDE_TOOL_NAME_INDEX,
  CODEX_FUNCTION_NAME_INDEX,
  CODEX_SKIP_PAYLOAD_TYPES,
  type SideEffectKind
} from './mapping-table';
import { stripClaudeCliEnvelopes, stripCodexUserEnvelopes } from '../../../shared/cli-text-envelopes';
import {
  renderReportFindingsMarkdown,
  renderCodexReviewOutputMarkdown,
  normalizeNativeReview,
  isForkedSkillLaunch,
  type CodexReviewOutput,
  type ReportFinding
} from '../../../shared/review-findings-markdown';

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
  | { kind: 'review'; markdown: string; title?: string; eventId?: string; completedAt?: string; usedFallback?: boolean };

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
  /** Claude only: uuid of an in-flight `/code-review` local-command user turn,
   *  awaiting the `system`/`local_command` record (child via `parentUuid`)
   *  that carries its stdout. Only review-triggering commands are tracked —
   *  ordinary chat turns never enter this map, so it stays effectively empty
   *  between reviews. */
  pendingLocalReviewCommand?: string;
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

  // `/code-review` runs as a local command, not a normal agentic turn — no
  // assistant message, no tool_use (verified against real transcripts on both
  // trivial and multi-file diffs). Its findings land in this `system` record.
  // Must be checked BEFORE the skip-list below: `system` is blanket-skipped
  // there (session-init logging etc.), and this is the one `system` subtype
  // that carries content worth persisting.
  if (obj.type === 'system' && obj.subtype === 'local_command') {
    return mapClaudeLocalCommand(obj, state);
  }

  if (CLAUDE_SKIP_EVENT_TYPES.has(obj.type)) return EMPTY;

  if (obj.type === 'assistant' || obj.type === 'user' || obj.type === 'message') {
    return mapClaudeMessageRecord(obj, state);
  }

  return EMPTY;
}

const LOCAL_COMMAND_STDOUT_RE = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/;

function mapClaudeLocalCommand(obj: ClaudeRecord, state: MapperState): MapperResult {
  const pendingUuid = state.pendingLocalReviewCommand;
  if (!pendingUuid || obj.parentUuid !== pendingUuid) return EMPTY;
  // Consume regardless of outcome — this local command has been resolved one
  // way or another, there's nothing left to correlate against.
  state.pendingLocalReviewCommand = undefined;

  const raw = typeof obj.content === 'string' ? obj.content : '';
  const match = raw.match(LOCAL_COMMAND_STDOUT_RE);
  const markdown = (match ? match[1] : raw).trim();
  if (!markdown) return EMPTY;

  const uuid = obj.uuid ?? `local-command-${pendingUuid}`;
  const timestamp = parseTimestamp(obj.timestamp);
  const createdAt = timestamp ?? Date.now();
  const messages: MapperResult['messages'] = [
    // Rendered assistant-style, matching the SDK's own doc comment for the
    // equivalent builtin message type: "Output from a local slash command …
    // Displayed as assistant-style text in the transcript."
    { uuid, role: 'assistant', parts: [{ type: 'text', text: markdown }], createdAt }
  ];

  // Forked to a background skill agent — this stdout is a launch ack, not a
  // review. Nothing to persist (see isForkedSkillLaunch doc comment).
  if (isForkedSkillLaunch(raw)) return { messages, sideEffects: [] };

  const normalized = normalizeNativeReview(markdown);
  return {
    messages,
    sideEffects: [
      {
        kind: 'review',
        markdown: normalized.markdown,
        title: 'Code Review',
        eventId: uuid,
        ...(timestamp !== null ? { completedAt: new Date(timestamp).toISOString() } : {}),
        usedFallback: normalized.usedFallback
      }
    ]
  };
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
    // Native `/review` result — verified against a real rollout transcript:
    // `exited_review_mode.review_output` carries structured findings. The
    // human-readable text is ALSO emitted as a normal assistant `message`
    // response_item (handled by mapCodexResponseItem below), so this branch
    // only contributes the review side-effect, no message part.
    if (payloadType === 'exited_review_mode')
      return mapCodexExitedReviewMode(payload as unknown as CodexExitedReviewModePayload, obj);
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
  /** `type: 'system'` records only (e.g. `subtype: 'local_command'` — the
   *  output of a built-in slash command like `/code-review`, wrapped in
   *  `<local-command-stdout>`/`<local-command-stderr>` tags). */
  subtype?: string;
  content?: string;
}

/** Commands whose local-command stdout should be captured as a review side
 *  effect. Matched case-insensitively against the leading token of the user's
 *  raw slash-command text (e.g. "/code-review high" → "/code-review"). */
const REVIEW_LOCAL_COMMANDS = new Set(['/code-review']);

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
  if (role === 'user' && typeof content === 'string') {
    const firstToken = content.trim().split(/\s/, 1)[0]?.toLowerCase();
    if (firstToken && REVIEW_LOCAL_COMMANDS.has(firstToken)) {
      state.pendingLocalReviewCommand = uuid;
    }
  }
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
  summary?: Array<{ type?: string; text?: string }> | unknown; // reasoning text lives here
  encrypted_content?: unknown; // opaque reasoning blob (unrenderable)
  name?: string; // function_call name
  call_id?: string;
  arguments?: string; // JSON-stringified call args
  output?: unknown; // function_call_output
}

/** Codex `message` / `reasoning` response_items carry NO `id` field (verified
 *  across every on-disk rollout transcript). Synthesize a stable id from the
 *  record's intrinsic, immutable fields so ingestion stays idempotent: an
 *  append-only file re-walked from byte 0 (manual Refresh / repair / crash
 *  catch-up) derives the SAME id and the unique (sub_chat_id, id) index +
 *  `seen` set dedup it. Must NOT depend on record position (a counter breaks
 *  across the resume/full-rewalk boundary) or on Date.now() (non-deterministic).
 *  The raw envelope timestamp + role + content/summary/encrypted_content
 *  uniquely identify a record; encrypted_content disambiguates reasoning blocks
 *  with empty summaries. */
function codexSyntheticId(prefix: string, tsRaw: string, payload: CodexResponsePayload): string {
  const sig = JSON.stringify({
    t: tsRaw,
    r: payload.role ?? null,
    c: payload.content ?? null,
    s: payload.summary ?? null,
    e: payload.encrypted_content ?? null
  });
  return `${prefix}-${createHash('sha1').update(sig).digest('hex').slice(0, 32)}`;
}

interface CodexPatchApplyEndPayload {
  type: 'patch_apply_end';
  call_id?: string;
  success?: boolean;
  changes?: Record<string, { kind?: 'add' | 'delete' | 'update' | string }>;
}

/** Verified against a real rollout transcript produced by `codex exec review`
 *  (which shares the review engine with the interactive `/review` command):
 *  `{ type: 'exited_review_mode', turn_id, item_id, review_output: {
 *    findings: [{ title, body, confidence_score, priority,
 *    code_location: { absolute_file_path, line_range: { start, end } } }],
 *    overall_correctness, overall_explanation, overall_confidence_score } }`. */
interface CodexExitedReviewModePayload {
  type: 'exited_review_mode';
  turn_id?: string;
  item_id?: string;
  review_output?: CodexReviewOutput;
}

function mapCodexResponseItem(envelope: CodexRecord, payload: CodexResponsePayload, state: MapperState): MapperResult {
  const createdAt = parseTimestamp(envelope.timestamp) ?? Date.now();
  // Pass the RAW timestamp string (not the Date.now()-fallback `createdAt`) to
  // the id synthesizer so a record with no timestamp can't get a non-deterministic id.
  const tsRaw = typeof envelope.timestamp === 'string' ? envelope.timestamp : '';

  switch (payload.type) {
    case 'message':
      return mapCodexMessage(payload, createdAt, tsRaw);
    case 'reasoning':
      return mapCodexReasoning(payload, createdAt, tsRaw);
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

function mapCodexMessage(payload: CodexResponsePayload, createdAt: number, tsRaw: string): MapperResult {
  // Codex `developer`-role records (system prompt, collaboration mode, skills)
  // map to no role and are intentionally dropped.
  const role = payload.role === 'user' ? 'user' : payload.role === 'assistant' ? 'assistant' : null;
  if (!role) return EMPTY;

  const parts: MessagePart[] = [];
  if (Array.isArray(payload.content)) {
    for (const block of payload.content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'input_text' || block.type === 'output_text') {
        const raw = typeof block.text === 'string' ? block.text : '';
        // Strip Codex's machine-injected wrappers (environment_context,
        // turn_aborted, MCP reminder) from user turns so only the human's
        // prompt renders; an all-wrapper record strips to empty and is dropped.
        const text = role === 'user' ? stripCodexUserEnvelopes(raw) : raw;
        if (text.trim()) parts.push({ type: 'text', text });
      }
    }
  }
  if (parts.length === 0) return EMPTY;
  // Codex messages carry no `id`; synthesize a stable one (see codexSyntheticId).
  const uuid = payload.id ?? codexSyntheticId('codex-msg', tsRaw, payload);
  return { messages: [{ uuid, role, parts, createdAt }], sideEffects: [] };
}

function mapCodexReasoning(payload: CodexResponsePayload, createdAt: number, tsRaw: string): MapperResult {
  // Codex packs reasoning text under `summary[]` ({type:'summary_text', text}).
  // `content[]` is always empty in practice and `encrypted_content` is opaque;
  // accept summary[] first, then content[], then a top-level `text` for forward/
  // backward-compat across Codex versions. Records with no decodable text
  // (empty summary + encrypted-only) yield nothing and are dropped.
  let text = '';
  const blocks = Array.isArray(payload.summary)
    ? payload.summary
    : Array.isArray(payload.content)
      ? payload.content
      : null;
  if (blocks) {
    for (const block of blocks) {
      if (block && typeof block === 'object' && typeof block.text === 'string') {
        text += (text ? '\n' : '') + block.text;
      }
    }
  } else if (typeof (payload as unknown as { text?: string }).text === 'string') {
    text = (payload as unknown as { text: string }).text;
  }
  if (!text.trim()) return EMPTY;
  const uuid = payload.id ?? codexSyntheticId('codex-reasoning', tsRaw, payload);
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

function mapCodexExitedReviewMode(payload: CodexExitedReviewModePayload, envelope: CodexRecord): MapperResult {
  const reviewOutput = payload.review_output;
  if (!reviewOutput) return EMPTY;
  const normalized = normalizeNativeReview(renderCodexReviewOutputMarkdown(reviewOutput));
  const timestamp = parseTimestamp(envelope.timestamp);
  const completedAt = timestamp ?? Date.now();
  return {
    messages: [],
    sideEffects: [
      {
        kind: 'review',
        markdown: normalized.markdown,
        title: 'Code Review',
        eventId: payload.item_id ?? payload.turn_id ?? `codex-review-${completedAt}`,
        ...(timestamp !== null ? { completedAt: new Date(timestamp).toISOString() } : {}),
        usedFallback: normalized.usedFallback
      }
    ]
  };
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
      // MCP write_review uses `markdown` directly; ReportFindings (Claude's
      // /code-review skill, in the rare case it surfaces as a top-level
      // tool_use rather than local-command stdout) carries a `findings` array.
      if (typeof inp.markdown === 'string' && inp.markdown) {
        const title = typeof inp.title === 'string' ? inp.title : undefined;
        return [{ kind: 'review', markdown: inp.markdown, ...(title ? { title } : {}) }];
      }
      if (Array.isArray(inp.findings)) {
        const markdown = renderReportFindingsMarkdown(inp.findings as ReportFinding[]);
        return [{ kind: 'review', markdown, title: 'Code Review' }];
      }
      return [];
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
