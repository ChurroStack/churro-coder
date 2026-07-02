import { and, asc, desc, eq, gt, like, lt, sql } from 'drizzle-orm';
import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { getDatabase, messages, subChats } from '../../db';
import { spillPath, writePartIfLargeSync } from '../../db/part-spill';
import { firstTextOfParts, isMachineInjectedUserText } from '../../../../shared/message-parts';
import { stripClaudeCliEnvelopes, stripCodexUserEnvelopes } from '../../../../shared/cli-text-envelopes';
import { publicProcedure, router } from '../index';

type SessionPromptRow = {
  id: string;
  idx: number;
  role: string;
  parts: string;
  metadata: string | null;
  text: string;
};

/**
 * Extract the human-readable, envelope-stripped first-text of a user row's
 * parts. CLI transcripts wrap user text in slash-command / MCP-reminder
 * envelopes (claude) or environment-context wrappers (codex); the builtin
 * harness has none (the claude stripper is then a near no-op). Returns '' when
 * the row carries no renderable text (e.g. a tool_result-only user record).
 */
function strippedUserText(partsJson: string, harness: string | null | undefined): string {
  let parts: unknown;
  try {
    parts = JSON.parse(partsJson);
  } catch {
    return '';
  }
  const raw = firstTextOfParts(parts);
  if (!raw) return '';
  const stripped = harness === 'codex-cli' ? stripCodexUserEnvelopes(raw) : stripClaudeCliEnvelopes(raw);
  return stripped.trim();
}

function safeSpillPath(subChatId: string, messageId: string, partIdx: number): string {
  const resolved = spillPath(subChatId, messageId, partIdx);
  const root = path.join(app.getPath('userData'), 'agent-sessions');
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error('Invalid spill path — possible path traversal');
  }
  return resolved;
}

export const messagesRouter = router({
  /**
   * Fetch the last N messages for a sub_chat (chronological order).
   * Returns an empty array if the sub_chat hasn't been migrated yet.
   */
  getLatest: publicProcedure
    .input(z.object({ subChatId: z.string(), limit: z.number().min(1).max(200).default(50) }))
    .query(({ input }) => {
      const db = getDatabase();
      return db
        .select()
        .from(messages)
        .where(eq(messages.subChatId, input.subChatId))
        .orderBy(desc(messages.idx))
        .limit(input.limit)
        .all()
        .reverse();
    }),

  /**
   * Return the session's first and last *user* inputs for the Session widget +
   * the CLI pane's "always show the original prompt" pin. Works for every
   * harness (the `messages` table is the shared store for builtin + CLI).
   *
   * "first"/"last" skip envelope-only user rows (slash-command tags, MCP
   * reminders, tool_result carriers) and machine-injected notices
   * (`<task-notification>` sub-agent pings, `<system-reminder>`, interrupt
   * markers — see `isMachineInjectedUserText`) by scanning a small window from
   * each end and picking the first row whose stripped text is non-empty. The
   * full row (id/idx/parts/metadata) is returned so the pane can render `first`
   * through the same message pipeline; `text` is the pre-stripped display
   * string. This filtering is query-time only — the CLI conversation
   * transcript (`getLatest`) renders these rows unchanged.
   */
  getSessionPrompts: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .query(({ input }): { first: SessionPromptRow | null; last: SessionPromptRow | null } => {
      const db = getDatabase();
      const sub = db.select({ harness: subChats.harness }).from(subChats).where(eq(subChats.id, input.subChatId)).get();
      const harness = sub?.harness ?? null;

      const cols = {
        id: messages.id,
        idx: messages.idx,
        role: messages.role,
        parts: messages.parts,
        metadata: messages.metadata
      };
      // Scan a window of *text-bearing* user rows from each end. The
      // `LIKE '%"type":"text"%'` filter excludes tool_result / data-image-only
      // user carriers in SQL (a long agentic tail can hold dozens of them), so
      // the genuine prompt — even after a burst of tool activity — lands inside
      // the window. Remaining envelope-only text rows (slash commands, MCP
      // reminders) are dropped by `strippedUserText` below.
      const TEXT_PART = like(messages.parts, '%"type":"text"%');
      const WINDOW = 16;
      const earliest = db
        .select(cols)
        .from(messages)
        .where(and(eq(messages.subChatId, input.subChatId), eq(messages.role, 'user'), TEXT_PART))
        .orderBy(asc(messages.idx))
        .limit(WINDOW)
        .all();
      const latest = db
        .select(cols)
        .from(messages)
        .where(and(eq(messages.subChatId, input.subChatId), eq(messages.role, 'user'), TEXT_PART))
        .orderBy(desc(messages.idx))
        .limit(WINDOW)
        .all();

      const pick = (rows: typeof earliest): SessionPromptRow | null => {
        for (const r of rows) {
          const raw = firstTextOfParts(
            (() => {
              try {
                return JSON.parse(r.parts);
              } catch {
                return null;
              }
            })()
          );
          if (raw && isMachineInjectedUserText(raw)) continue;
          const text = strippedUserText(r.parts, harness);
          if (text) return { ...r, text };
        }
        return null;
      };

      return { first: pick(earliest), last: pick(latest) };
    }),

  /**
   * Fetch up to limit messages with idx < beforeIdx (chronological order).
   * Used for upward infinite scroll — load older messages.
   */
  getBefore: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        beforeIdx: z.number().int().nonnegative(),
        limit: z.number().min(1).max(200).default(50)
      })
    )
    .query(({ input }) => {
      const db = getDatabase();
      return db
        .select()
        .from(messages)
        .where(and(eq(messages.subChatId, input.subChatId), lt(messages.idx, input.beforeIdx)))
        .orderBy(desc(messages.idx))
        .limit(input.limit)
        .all()
        .reverse();
    }),

  /**
   * Fetch up to limit messages with idx > afterIdx (chronological order).
   * Used for downward scroll after loading old history.
   */
  getAfter: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        afterIdx: z.number().int().nonnegative(),
        limit: z.number().min(1).max(200).default(50)
      })
    )
    .query(({ input }) => {
      const db = getDatabase();
      return db
        .select()
        .from(messages)
        .where(and(eq(messages.subChatId, input.subChatId), gt(messages.idx, input.afterIdx)))
        .orderBy(asc(messages.idx))
        .limit(input.limit)
        .all();
    }),

  /**
   * Fetch a single message by its original message id (not idx).
   * Used for fork-resume and rollback-by-id flows.
   */
  getById: publicProcedure.input(z.object({ subChatId: z.string(), messageId: z.string() })).query(({ input }) => {
    const db = getDatabase();
    return (
      db
        .select()
        .from(messages)
        .where(and(eq(messages.subChatId, input.subChatId), eq(messages.id, input.messageId)))
        .get() ?? null
    );
  }),

  /**
   * Read a full spilled part from disk.
   * The response is a JSON string (the original part serialization).
   * For parts > 32 MB use getPartRange instead to avoid loading the whole blob.
   */
  getPart: publicProcedure
    .input(z.object({ subChatId: z.string(), messageId: z.string(), partIdx: z.number().int().nonnegative() }))
    .query(async ({ input }) => {
      const filePath = safeSpillPath(input.subChatId, input.messageId, input.partIdx);
      const stat = await fs.stat(filePath);
      if (stat.size > 32 * 1024 * 1024) {
        throw new Error('Part too large — use getPartRange for byte-range access');
      }
      const content = await fs.readFile(filePath, 'utf8');
      return { content, bytes: stat.size };
    }),

  /**
   * Read a byte range from a spilled part.
   * Allows the renderer to page through large bash outputs (e.g. 47 MB) in 1 MB chunks.
   */
  getPartRange: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        messageId: z.string(),
        partIdx: z.number().int().nonnegative(),
        start: z.number().int().nonnegative(),
        length: z
          .number()
          .int()
          .min(1)
          .max(4 * 1024 * 1024) // 4 MB max chunk
      })
    )
    .query(async ({ input }) => {
      const filePath = safeSpillPath(input.subChatId, input.messageId, input.partIdx);
      const fh = await fs.open(filePath, 'r');
      try {
        const stat = await fh.stat();
        const buf = Buffer.alloc(input.length);
        const { bytesRead } = await fh.read(buf, 0, input.length, input.start);
        return {
          content: buf.slice(0, bytesRead).toString('utf8'),
          bytesRead,
          totalBytes: stat.size,
          eof: bytesRead < input.length
        };
      } finally {
        await fh.close();
      }
    }),

  /**
   * Append a single message to the messages table for a sub_chat.
   * Returns the assigned idx.
   */
  append: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        message: z.object({
          id: z.string(),
          role: z.enum(['user', 'assistant']),
          parts: z.array(z.any()),
          metadata: z.any().optional()
        })
      })
    )
    .mutation(({ input }) => {
      const db = getDatabase();

      const result = db
        .select({ m: sql<number | null>`max(${messages.idx})` })
        .from(messages)
        .where(eq(messages.subChatId, input.subChatId))
        .get();
      const nextIdx = (result?.m ?? -1) + 1;

      const processedParts = input.message.parts.map((p: unknown, i: number) => {
        try {
          return writePartIfLargeSync(input.subChatId, input.message.id, i, p);
        } catch {
          return p;
        }
      });

      db.insert(messages)
        .values({
          subChatId: input.subChatId,
          idx: nextIdx,
          id: input.message.id,
          role: input.message.role,
          parts: JSON.stringify(processedParts),
          metadata: input.message.metadata ? JSON.stringify(input.message.metadata) : null,
          createdAt: new Date()
        })
        .onConflictDoNothing()
        .run();

      // fileStats* columns are intentionally not updated here — they require the full
      // message array (computeFileStatsFromMessages) which is only available in the
      // main write paths (writeMessagesToTable / replaceMessagesInTable).
      db.update(subChats)
        .set({
          messageCount: sql`${subChats.messageCount} + 1`,
          lastMessageIdx: nextIdx
        })
        .where(eq(subChats.id, input.subChatId))
        .run();

      return nextIdx;
    })
});
