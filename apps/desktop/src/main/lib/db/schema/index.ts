import { index, primaryKey, sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { createId } from '../utils';

// ============ PROJECTS ============
export const projects = sqliteTable('projects', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  // Git remote info (extracted from local .git)
  gitRemoteUrl: text('git_remote_url'),
  gitProvider: text('git_provider'), // "github" | "gitlab" | "bitbucket" | "azure" | null
  gitOwner: text('git_owner'),
  gitRepo: text('git_repo'),
  gitProject: text('git_project'), // Azure DevOps project (null for other providers)
  // Custom project icon (absolute path to local image file)
  iconPath: text('icon_path'),
  // Sandbox: null = use global default (true), false/true = project override
  sandboxEnabled: integer('sandbox_enabled', { mode: 'boolean' })
});

export const projectsRelations = relations(projects, ({ many }) => ({
  chats: many(chats),
  environmentVariables: many(projectEnvironmentVariables)
}));

// ============ PROJECT ENVIRONMENT VARIABLES ============
// Project-wide KEY=VALUE pairs applied to every spawned process (terminals,
// scripts, Claude/Codex CLIs). Shared across all of a project's worktrees.
// Protected values are encrypted at rest with Electron safeStorage (see
// lib/db/env-secret.ts); unprotected values are stored as plaintext.
export const projectEnvironmentVariables = sqliteTable(
  'project_environment_variables',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    // Plaintext when isProtected=false; safeStorage(base64) ciphertext when true.
    value: text('value').notNull(),
    isProtected: integer('is_protected', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
  },
  (table) => [uniqueIndex('project_env_vars_project_key_uq').on(table.projectId, table.key)]
);

export const projectEnvironmentVariablesRelations = relations(projectEnvironmentVariables, ({ one }) => ({
  project: one(projects, {
    fields: [projectEnvironmentVariables.projectId],
    references: [projects.id]
  })
}));

// ============ CHATS ============
export const chats = sqliteTable(
  'chats',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    name: text('name'),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    archivedAt: integer('archived_at', { mode: 'timestamp' }),
    // Worktree fields (for git isolation per chat)
    worktreePath: text('worktree_path'),
    branch: text('branch'),
    baseBranch: text('base_branch'),
    // PR tracking fields
    prUrl: text('pr_url'),
    prNumber: integer('pr_number'),
    // Sandbox: null = inherit from project, false/true = chat override
    sandboxEnabled: integer('sandbox_enabled', { mode: 'boolean' }),
    // JSON array of tools used at openspec init, e.g. '["claude","codex"]'
    openspecTools: text('openspec_tools')
  },
  (table) => [
    index('chats_worktree_path_idx').on(table.worktreePath),
    index('chats_project_id_idx').on(table.projectId)
  ]
);

export const chatsRelations = relations(chats, ({ one, many }) => ({
  project: one(projects, {
    fields: [chats.projectId],
    references: [projects.id]
  }),
  subChats: many(subChats)
}));

// ============ SUB-CHATS ============
export const subChats = sqliteTable(
  'sub_chats',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    // NULL = never-named; the app.quit cleanup in main/index.ts (and
    // chats.deleteSubChatIfEmpty / deleteSubChatsIfEmpty) deletes rows where
    // message_count = 0 AND name IS NULL. Adding a non-null default would
    // break that GC. Auto-rename triggers (first user message, first
    // write_plan) flip this to a real title once the user invests effort —
    // see sub-chats/placeholders.ts for the placeholder-name set.
    name: text('name'),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    sessionId: text('session_id'), // Claude SDK session ID for resume
    sessionMode: text('session_mode'), // "plan" | "execute" | "explore" — mode the active sessionId was started with
    streamId: text('stream_id'), // Track in-progress streams
    mode: text('mode').notNull().default('plan'), // "plan" | "execute" | "explore"
    openspecChangeId: text('openspec_change_id'), // OpenSpec change folder name this sub-chat is bound to
    harness: text('harness').notNull().default('builtin'), // 'builtin' | 'claude-cli' | 'codex-cli' — immutable after creation
    // Cached file stats — kept in sync by writers, read by getFileStats to avoid JSON parse on every query
    fileStatsAdditions: integer('file_stats_additions').notNull().default(0),
    fileStatsDeletions: integer('file_stats_deletions').notNull().default(0),
    fileStatsFileCount: integer('file_stats_file_count').notNull().default(0),
    // Denormalized counters kept in sync by all message write paths
    messageCount: integer('message_count').notNull().default(0),
    lastMessageIdx: integer('last_message_idx'), // NULL when empty
    bootstrappedAt: integer('bootstrapped_at', { mode: 'timestamp' }),
    // CLI-session ingestion (claude-cli / codex-cli only). Resolved by the
    // session-file locator after the PTY spawns and persisted so the
    // ingester can re-attach a watcher on app restart without re-detecting.
    // cliSessionFile is a *hint* — the locator may re-run if the file no
    // longer exists (e.g. machine move). cliSessionId doubles as the
    // session UUID to pass to `claude --resume` / `codex resume`.
    cliSessionId: text('cli_session_id'),
    cliSessionFile: text('cli_session_file'),
    cliSessionDetectedAt: integer('cli_session_detected_at'),
    // Rolling, LLM-generated session summary shown in the Session sidebar widget.
    // `summary` is the latest few-sentence summary; `summaryLastIdx` is the
    // highest message idx already folded into it (incremental updates feed only
    // rows with idx > summaryLastIdx, never the whole session); `summaryUpdatedAt`
    // is when it was last regenerated. NULL = never summarized.
    summary: text('summary'),
    summaryUpdatedAt: integer('summary_updated_at', { mode: 'timestamp' }),
    summaryLastIdx: integer('summary_last_idx'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
  },
  (table) => [
    index('sub_chats_chat_id_idx').on(table.chatId),
    index('sub_chats_stream_id_idx').on(table.streamId),
    uniqueIndex('sub_chats_chat_id_openspec_change_id_unique')
      .on(table.chatId, table.openspecChangeId)
      .where(sql`${table.openspecChangeId} IS NOT NULL`)
  ]
);

export const subChatsRelations = relations(subChats, ({ one, many }) => ({
  chat: one(chats, {
    fields: [subChats.chatId],
    references: [chats.id]
  }),
  messages: many(messages)
}));

// ============ MESSAGES ============
// One row per message. Replaces the sub_chats.messages JSON blob.
// PK is (sub_chat_id, idx) — idx is 0-based, monotonic, append-only.
// Large parts (≥256 KB) are spilled to disk and replaced by a _spill envelope.
export const messages = sqliteTable(
  'messages',
  {
    subChatId: text('sub_chat_id')
      .notNull()
      .references(() => subChats.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(), // 0-based position in this sub_chat's message stream
    id: text('id').notNull(), // original message id (msg-... or uuid)
    role: text('role').notNull(), // 'user' | 'assistant'
    parts: text('parts').notNull(), // JSON array; large parts already spilled to disk
    metadata: text('metadata'), // JSON; nullable
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
  },
  (table) => [
    primaryKey({ columns: [table.subChatId, table.idx] }),
    uniqueIndex('messages_sub_chat_id_message_id_uq').on(table.subChatId, table.id)
  ]
);

export const messagesRelations = relations(messages, ({ one }) => ({
  subChat: one(subChats, {
    fields: [messages.subChatId],
    references: [subChats.id]
  })
}));

// ============ CLAUDE CODE CREDENTIALS ============
// Stores encrypted OAuth token for Claude Code integration
// DEPRECATED: Use anthropicAccounts for multi-account support
export const claudeCodeCredentials = sqliteTable('claude_code_credentials', {
  id: text('id').primaryKey().default('default'), // Single row, always "default"
  oauthToken: text('oauth_token').notNull(), // Encrypted with safeStorage
  connectedAt: integer('connected_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  userId: text('user_id') // Desktop auth user ID (for reference)
});

// ============ ANTHROPIC ACCOUNTS (Multi-account support) ============
// Stores multiple Anthropic OAuth accounts for quick switching
export const anthropicAccounts = sqliteTable('anthropic_accounts', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  email: text('email'), // User's email from OAuth (if available)
  displayName: text('display_name'), // User-editable label
  oauthToken: text('oauth_token').notNull(), // Encrypted with safeStorage
  connectedAt: integer('connected_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  desktopUserId: text('desktop_user_id') // Reference to remote user (legacy column; remote auth removed)
});

// Tracks which Anthropic account is currently active
export const anthropicSettings = sqliteTable('anthropic_settings', {
  id: text('id').primaryKey().default('singleton'), // Single row
  activeAccountId: text('active_account_id'), // References anthropicAccounts.id
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
});

// ============ SANDBOX SETTINGS ============
export const sandboxSettings = sqliteTable('sandbox_settings', {
  id: text('id').primaryKey().default('singleton'),
  sandboxEnabled: integer('sandbox_enabled', { mode: 'boolean' }).notNull().default(true),
  extraWritablePaths: text('extra_writable_paths').notNull().default('[]'),
  extraDeniedPaths: text('extra_denied_paths').notNull().default('[]'),
  allowToolchainCaches: integer('allow_toolchain_caches', { mode: 'boolean' }).notNull().default(true),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
});

// ============ TIME / BILLING LEDGERS ============
// FK-FREE on purpose: rows MUST survive project / chat / sub-chat deletion so
// invoicing ("this month, by project") still shows entities that were later
// archived or hard-deleted. All project/chat/sub-chat fields are denormalized
// SNAPSHOTS captured at write time and are never rewritten retroactively.

// Raw agent work intervals (one row per turn / backfilled session span).
// Runtime is SUM(ended_at - started_at). started_at/ended_at are ms-epoch
// integers (not timestamp mode) so interval math stays simple in SQL.
export const workIntervals = sqliteTable(
  'work_intervals',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    subChatId: text('sub_chat_id').notNull(),
    projectId: text('project_id'),
    projectName: text('project_name'),
    chatId: text('chat_id'),
    chatName: text('chat_name'),
    subChatName: text('sub_chat_name'),
    harness: text('harness').notNull().default('builtin'), // 'builtin' | 'claude-cli' | 'codex-cli'
    source: text('source'), // 'builtin' | 'claude' | 'codex'
    startedAt: integer('started_at').notNull(), // ms since epoch
    endedAt: integer('ended_at'), // ms since epoch; NULL = open (in-progress or left open by a crash)
    origin: text('origin').notNull().default('live'), // 'live' (builtin turns) | 'derived' (CLI, from message timestamps)
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
  },
  (table) => [
    index('work_intervals_sub_chat_id_idx').on(table.subChatId),
    index('work_intervals_started_at_idx').on(table.startedAt)
  ]
);

// Per-(local day, session, provider, model) token + cost rollup.
// cost stored as INTEGER micro-USD to avoid float cent drift across many rows.
// subChatId may be the '__unattributed__' sentinel for usage that matched no
// session (still counted in grand totals, just not per-project).
export const tokenDaily = sqliteTable(
  'token_daily',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    dateKey: text('date_key').notNull(), // 'YYYY-MM-DD' in local tz
    projectId: text('project_id'),
    projectName: text('project_name'),
    chatId: text('chat_id'),
    chatName: text('chat_name'),
    subChatId: text('sub_chat_id').notNull(),
    subChatName: text('sub_chat_name'),
    harness: text('harness'), // 'builtin' | 'claude-cli' | 'codex-cli' | null (unattributed) — for the harness spend axis
    source: text('source').notNull(), // 'claude' | 'codex' — provider axis
    model: text('model').notNull(), // raw model id
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    costMicroUsd: integer('cost_micro_usd').notNull().default(0), // integer micro-USD (1e-6)
    unpriced: integer('unpriced', { mode: 'boolean' }).notNull().default(false), // model missing from pricing table
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
  },
  (table) => [
    uniqueIndex('token_daily_day_subchat_source_model_uq').on(
      table.dateKey,
      table.subChatId,
      table.source,
      table.model
    ),
    index('token_daily_date_key_idx').on(table.dateKey)
  ]
);

// ============ TYPE EXPORTS ============
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type SubChat = typeof subChats.$inferSelect;
export type NewSubChat = typeof subChats.$inferInsert;
export type ClaudeCodeCredential = typeof claudeCodeCredentials.$inferSelect;
export type NewClaudeCodeCredential = typeof claudeCodeCredentials.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type AnthropicAccount = typeof anthropicAccounts.$inferSelect;
export type NewAnthropicAccount = typeof anthropicAccounts.$inferInsert;
export type AnthropicSettings = typeof anthropicSettings.$inferSelect;
export type SandboxSettings = typeof sandboxSettings.$inferSelect;
export type WorkInterval = typeof workIntervals.$inferSelect;
export type NewWorkInterval = typeof workIntervals.$inferInsert;
export type TokenDaily = typeof tokenDaily.$inferSelect;
export type NewTokenDaily = typeof tokenDaily.$inferInsert;
