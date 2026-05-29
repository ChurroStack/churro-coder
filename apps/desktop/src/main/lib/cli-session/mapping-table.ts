/**
 * MAPPING_TABLE — single source of truth for how harness-native JSONL events
 * translate into the renderer's part-type vocabulary (and which ones also
 * emit a side-effect: a file change, plan, or task list).
 *
 * Imported by:
 *   - jsonl-mapper.ts (drives the per-line translation)
 *   - scripts/gen-mapping-docs.ts (regenerates the table in
 *     apps/desktop/docs/cli-session-mapping.md)
 *
 * Keep this file declarative — no logic. The mapper does the actual decoding,
 * pivoting on the `partType` keys here for the "what renderer component will
 * pick this up" question, and on the `claude.toolName` / `codex.functionName`
 * helpers to find side-effect candidates.
 */

export type SideEffectKind = 'file-change' | 'plan' | 'tasks' | 'review';

export interface MappingRow {
  /** Renderer part-type string (matches `part.type` consumed by
   *  AssistantMessageItem). `null` means the row is skip-only or
   *  side-effect-only. */
  partType: string | null;
  /** Renderer component name (for docs only — not used at runtime). */
  rendererComponent: string | null;
  /** Human-readable description. Appears in the generated docs. */
  description: string;
  /** Claude-side hook: top-level event types, content[].type values, and
   *  tool_use.name values that this row applies to. */
  claude: {
    eventTypes?: string[];
    contentTypes?: string[];
    toolNames?: string[];
    notes?: string;
  };
  /** Codex-side hook. */
  codex: {
    payloadTypes?: string[];
    functionNames?: string[];
    notes?: string;
  };
  /** If set, the mapper emits a side-effect of this kind in addition to the
   *  part (or instead of, if `partType` is null). */
  sideEffect?: SideEffectKind;
}

export const MAPPING_TABLE: MappingRow[] = [
  // ── Text & reasoning ───────────────────────────────────────────────────
  {
    partType: 'text',
    rendererComponent: 'MemoizedTextPart',
    description: 'Plain text content (assistant or user).',
    claude: {
      contentTypes: ['text'],
      notes: 'Claude may also send content as a bare string for simple user messages.'
    },
    codex: { payloadTypes: ['message'], notes: 'Inside response_item.payload.content[]: input_text and output_text.' }
  },
  {
    partType: 'reasoning',
    rendererComponent: 'AgentThinkingTool',
    description: 'Extended thinking / chain-of-thought.',
    claude: { contentTypes: ['thinking'] },
    codex: { payloadTypes: ['reasoning'], notes: 'Codex emits reasoning as a top-level response_item, not inline.' }
  },

  // ── Shell ──────────────────────────────────────────────────────────────
  {
    partType: 'tool-Bash',
    rendererComponent: 'AgentBashTool',
    description: 'Shell command (Claude Bash / Codex exec_command).',
    claude: { toolNames: ['Bash'] },
    codex: {
      functionNames: ['exec_command', 'write_stdin'],
      notes: 'write_stdin merges into the same tool part by call_id.'
    }
  },

  // ── File edits ─────────────────────────────────────────────────────────
  {
    partType: 'tool-Edit',
    rendererComponent: 'AgentEditTool / AgentPlanFileTool (if .md)',
    description: 'Single-file edit.',
    claude: { toolNames: ['Edit'] },
    codex: { functionNames: ['apply_patch'], notes: 'Codex synthesizes per-file edits from a multi-file patch.' },
    sideEffect: 'file-change'
  },
  {
    partType: 'tool-Write',
    rendererComponent: 'AgentEditTool / AgentPlanFileTool (if .md)',
    description: 'File create.',
    claude: { toolNames: ['Write'] },
    codex: { functionNames: ['apply_patch'] },
    sideEffect: 'file-change'
  },
  {
    partType: 'tool-MultiEdit',
    rendererComponent: 'AgentEditTool',
    description: 'Multi-edit operation on a single file.',
    claude: { toolNames: ['MultiEdit'] },
    codex: {},
    sideEffect: 'file-change'
  },
  {
    partType: 'tool-NotebookEdit',
    rendererComponent: 'AgentToolCall',
    description: 'Jupyter notebook edit.',
    claude: { toolNames: ['NotebookEdit'] },
    codex: {},
    sideEffect: 'file-change'
  },

  // ── File reads / search ────────────────────────────────────────────────
  {
    partType: 'tool-Read',
    rendererComponent: 'AgentToolCall',
    description: 'File read.',
    claude: { toolNames: ['Read'] },
    codex: { notes: 'Codex shells out via exec_command (cat/head); not re-classified in v1 — falls into tool-Bash.' }
  },
  {
    partType: 'tool-Grep',
    rendererComponent: 'AgentToolCall',
    description: 'Pattern search.',
    claude: { toolNames: ['Grep'] },
    codex: { notes: 'See tool-Read note.' }
  },
  {
    partType: 'tool-Glob',
    rendererComponent: 'AgentToolCall',
    description: 'File glob.',
    claude: { toolNames: ['Glob'] },
    codex: { notes: 'See tool-Read note.' }
  },

  // ── Web ────────────────────────────────────────────────────────────────
  {
    partType: 'tool-WebSearch',
    rendererComponent: 'AgentWebSearchCollapsible',
    description: 'Web search query.',
    claude: { toolNames: ['WebSearch'] },
    codex: { notes: 'No native equivalent in Codex 0.124.' }
  },
  {
    partType: 'tool-WebFetch',
    rendererComponent: 'AgentWebFetchTool',
    description: 'HTTP fetch / page content.',
    claude: { toolNames: ['WebFetch'] },
    codex: { functionNames: ['view_image'], notes: 'view_image is the closest analogue (image URL).' }
  },

  // ── Sub-agents & user interaction ──────────────────────────────────────
  {
    partType: 'tool-Task',
    rendererComponent: 'AgentTaskTool',
    description: 'Sub-agent dispatch.',
    claude: { toolNames: ['Agent', 'Task'] },
    codex: { notes: 'No equivalent.' }
  },
  {
    partType: 'tool-AskUserQuestion',
    rendererComponent: 'AgentAskUserQuestionTool',
    description: 'Structured user question.',
    claude: { toolNames: ['AskUserQuestion'] },
    codex: { notes: 'Native equivalent is only the MCP request_user_input path.' }
  },

  // ── Todo / plan ────────────────────────────────────────────────────────
  {
    partType: 'tool-TodoWrite',
    rendererComponent: 'AgentTodoTool',
    description: 'Todo / checklist update.',
    claude: { toolNames: ['TodoWrite'] },
    codex: { functionNames: ['update_plan'], notes: 'Native Codex plan/todo tool.' },
    sideEffect: 'tasks'
  },
  {
    partType: 'tool-ExitPlanMode',
    rendererComponent: '(hidden)',
    description: 'Plan-mode exit — Claude CLI native plan tool; emits a plan side-effect.',
    claude: { toolNames: ['ExitPlanMode'] },
    codex: {},
    sideEffect: 'plan'
  },

  // ── MCP (churro-coder server) — special rich renderers ─────────────────
  {
    partType: 'tool-mcp__churro-coder__write_plan',
    rendererComponent: 'AgentPlanTool',
    description: 'Plan write via our MCP server. Fills the plan store on the side.',
    claude: { toolNames: ['mcp__churro-coder__write_plan'] },
    codex: { functionNames: ['mcp__churro-coder__write_plan'] },
    sideEffect: 'plan'
  },
  {
    partType: 'tool-mcp__churro-coder__write_review',
    rendererComponent: 'AgentReviewTool',
    description: 'Review write via our MCP server.',
    claude: { toolNames: ['mcp__churro-coder__write_review'] },
    codex: { functionNames: ['mcp__churro-coder__write_review'] },
    sideEffect: 'review'
  },
  {
    partType: 'tool-mcp__churro-coder__write_tasks',
    rendererComponent: 'AgentMcpToolCall',
    description: 'Task list write via our MCP server.',
    claude: { toolNames: ['mcp__churro-coder__write_tasks'] },
    codex: { functionNames: ['mcp__churro-coder__write_tasks'] },
    sideEffect: 'tasks'
  },
  {
    partType: 'tool-mcp__churro-coder__notify_files_changed',
    rendererComponent: 'AgentMcpToolCall',
    description: 'File change notification via our MCP server.',
    claude: { toolNames: ['mcp__churro-coder__notify_files_changed'] },
    codex: { functionNames: ['mcp__churro-coder__notify_files_changed'] },
    sideEffect: 'file-change'
  },
  {
    partType: 'tool-mcp__churro-coder__update_task_status',
    rendererComponent: 'AgentMcpToolCall',
    description: 'Task status update via our MCP server.',
    claude: { toolNames: ['mcp__churro-coder__update_task_status'] },
    codex: { functionNames: ['mcp__churro-coder__update_task_status'] },
    sideEffect: 'tasks'
  },
  {
    partType: 'tool-mcp__churro-coder__request_user_input',
    rendererComponent: 'AgentMcpToolCall',
    description: 'User-input request via our MCP server.',
    claude: { toolNames: ['mcp__churro-coder__request_user_input'] },
    codex: { functionNames: ['mcp__churro-coder__request_user_input'] }
  },
  {
    partType: 'tool-mcp__churro-coder__read_plan',
    rendererComponent: 'AgentMcpToolCall',
    description: 'Read previously persisted plan.',
    claude: { toolNames: ['mcp__churro-coder__read_plan'] },
    codex: { functionNames: ['mcp__churro-coder__read_plan'] }
  },
  {
    partType: 'tool-mcp__churro-coder__read_review',
    rendererComponent: 'AgentMcpToolCall',
    description: 'Read previously persisted review.',
    claude: { toolNames: ['mcp__churro-coder__read_review'] },
    codex: { functionNames: ['mcp__churro-coder__read_review'] }
  },

  // ── Catch-alls ─────────────────────────────────────────────────────────
  {
    partType: 'tool-mcp__<server>__<tool>',
    rendererComponent: 'AgentMcpToolCall (generic)',
    description: 'Any third-party MCP server tool.',
    claude: { notes: 'Any tool_use.name matching mcp__*__*' },
    codex: { notes: 'Any function_call.name matching mcp__*__*' }
  },
  {
    partType: 'tool-<Builtin>',
    rendererComponent: 'AgentToolCall (fallback)',
    description: 'Any other named tool. Never crashes — fallback renderer.',
    claude: { notes: 'Anything else from tool_use.name' },
    codex: { notes: 'Anything else from function_call.name' }
  },
  {
    partType: 'session-break',
    rendererComponent: 'inline divider (new)',
    description: 'Synthesized by the ingester when a fresh session file is detected without a successful resume.',
    claude: { notes: '(synthesized by ingester)' },
    codex: { notes: '(synthesized by ingester)' }
  },

  // ── Skipped (informational only) ───────────────────────────────────────
  {
    partType: null,
    rendererComponent: null,
    description: 'Informational events that carry no user-visible content.',
    claude: {
      eventTypes: [
        'last-prompt',
        'permission-mode',
        'bridge-session',
        'ai-title',
        'attachment',
        'file-history-snapshot',
        'queue-operation',
        'system',
        'agent_listing_delta',
        'deferred_tools_delta',
        'skill_listing',
        'plan_mode'
      ]
    },
    codex: {
      payloadTypes: [
        'turn_context',
        'session_meta',
        'token_count',
        'agent_message',
        'user_message',
        'task_started',
        'task_complete',
        'turn_aborted'
      ],
      notes: 'patch_apply_end and apply_patch are CONSUMED for the file-change side-effect (handled separately).'
    }
  }
];

/** Sets derived from MAPPING_TABLE for fast lookup. */
function indexClaudeToolNames(): Map<string, MappingRow> {
  const m = new Map<string, MappingRow>();
  for (const row of MAPPING_TABLE) {
    for (const t of row.claude.toolNames ?? []) m.set(t, row);
  }
  return m;
}
function indexCodexFunctionNames(): Map<string, MappingRow> {
  const m = new Map<string, MappingRow>();
  for (const row of MAPPING_TABLE) {
    for (const t of row.codex.functionNames ?? []) m.set(t, row);
  }
  return m;
}
function indexClaudeSkipEventTypes(): Set<string> {
  const s = new Set<string>();
  for (const row of MAPPING_TABLE) {
    if (row.partType === null) for (const t of row.claude.eventTypes ?? []) s.add(t);
  }
  return s;
}
function indexCodexSkipPayloadTypes(): Set<string> {
  const s = new Set<string>();
  for (const row of MAPPING_TABLE) {
    if (row.partType === null) for (const t of row.codex.payloadTypes ?? []) s.add(t);
  }
  return s;
}

export const CLAUDE_TOOL_NAME_INDEX = indexClaudeToolNames();
export const CODEX_FUNCTION_NAME_INDEX = indexCodexFunctionNames();
export const CLAUDE_SKIP_EVENT_TYPES = indexClaudeSkipEventTypes();
export const CODEX_SKIP_PAYLOAD_TYPES = indexCodexSkipPayloadTypes();
