import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { router, publicProcedure } from '../index';
import { chats, getDatabase, messages, projects, subChats } from '../../db';
import { watchChangeDir } from '../../openspec/openspec-watcher';
import {
  createChange,
  deleteChange,
  deleteChangeDelta,
  isInitialized,
  listArchivedChanges,
  listCapabilities,
  listChangeDeltas,
  listChanges,
  readArchivedChange,
  readArchivedChangeFile,
  readCapabilityFile,
  readChange,
  readChangeDelta,
  readChangeFile,
  readProjectContext,
  writeCapabilityFile,
  writeChangeDelta,
  writeChangeFile
} from '../../openspec/openspec-store';

const ROOT_INPUT = z
  .object({
    chatId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional()
  })
  .refine((v) => Boolean(v.chatId || v.projectId), {
    message: 'chatId or projectId is required'
  });

const FILE_KIND = z.enum(['proposal', 'tasks', 'design']);
const CAPABILITY_FILE_KIND = z.enum(['spec', 'design']);

async function dirExists(absPath: string): Promise<boolean> {
  try {
    const st = await stat(absPath);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve the directory that contains `openspec/`. Worktree-first, project-fallback:
 *
 *   - If `chatId` is provided and the chat has a non-empty `worktreePath` that
 *     still exists on disk, use it.
 *   - Otherwise, walk to the chat's project and use `projects.path` — this also
 *     covers the "worktree was deleted out from under us" case.
 *   - If only `projectId` is provided, use `projects.path` directly.
 *
 * Throws TRPCError NOT_FOUND when the requested chat / project does not exist
 * or has no usable path.
 */
async function resolveRootDir(input: { chatId?: string; projectId?: string }): Promise<string> {
  const db = getDatabase();

  if (input.chatId) {
    const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get();
    if (!chat) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Chat not found: ${input.chatId}` });
    }
    if (chat.worktreePath && chat.worktreePath.length > 0 && (await dirExists(chat.worktreePath))) {
      return chat.worktreePath;
    }
    if (chat.worktreePath && chat.worktreePath.length > 0) {
      console.warn(
        `[openspec] worktree missing for chat=${input.chatId} path=${chat.worktreePath}; falling back to project path`
      );
    }
    const project = db.select().from(projects).where(eq(projects.id, chat.projectId)).get();
    if (!project) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Project not found for chat: ${input.chatId}` });
    }
    return project.path;
  }

  // projectId-only path
  const project = db.select().from(projects).where(eq(projects.id, input.projectId!)).get();
  if (!project) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `Project not found: ${input.projectId}` });
  }
  return project.path;
}

export const openspecRouter = router({
  /** Whether `<rootDir>/openspec/` exists. */
  isInitialized: publicProcedure.input(ROOT_INPUT).query(async ({ input }) => {
    const rootDir = await resolveRootDir(input);
    return { initialized: await isInitialized(rootDir), rootDir };
  }),

  // ============ changes (active) ============

  listChanges: publicProcedure.input(ROOT_INPUT).query(async ({ input }) => {
    return listChanges(await resolveRootDir(input));
  }),

  readChange: publicProcedure
    .input(ROOT_INPUT.and(z.object({ changeId: z.string().min(1) })))
    .query(async ({ input }) => {
      return readChange(await resolveRootDir(input), input.changeId);
    }),

  readChangeFile: publicProcedure
    .input(
      ROOT_INPUT.and(
        z.object({
          changeId: z.string().min(1),
          kind: FILE_KIND
        })
      )
    )
    .query(async ({ input }) => {
      return readChangeFile(await resolveRootDir(input), input.changeId, input.kind);
    }),

  watchChange: publicProcedure
    .input(ROOT_INPUT.and(z.object({ changeId: z.string().min(1) })))
    .subscription(({ input }) =>
      observable<{ ts: number; exists: boolean }>((emit) => {
        let close: (() => Promise<void>) | null = null;
        let disposed = false;

        (async () => {
          const rootDir = await resolveRootDir(input);
          const dir = join(rootDir, 'openspec', 'changes', input.changeId);
          const handle = await watchChangeDir(dir, ({ exists }) => {
            if (!disposed) emit.next({ ts: Date.now(), exists });
          });

          if (disposed) {
            await handle.close();
          } else {
            close = () => handle.close();
          }
        })().catch((err) => {
          console.error(`[openspec/router] watchChange init failed changeId=${input.changeId}`, err);
          emit.error(err);
        });

        return () => {
          disposed = true;
          void close?.();
        };
      })
    ),

  writeChangeFile: publicProcedure
    .input(
      ROOT_INPUT.and(
        z.object({
          changeId: z.string().min(1),
          kind: FILE_KIND,
          content: z.string()
        })
      )
    )
    .mutation(async ({ input }) => {
      await writeChangeFile(await resolveRootDir(input), input.changeId, input.kind, input.content);
      return { ok: true };
    }),

  createChange: publicProcedure
    .input(
      ROOT_INPUT.and(
        z.object({
          changeId: z.string().min(1),
          files: z
            .object({
              proposal: z.string().optional(),
              tasks: z.string().optional(),
              design: z.string().optional()
            })
            .default({})
        })
      )
    )
    .mutation(async ({ input }) => {
      await createChange(await resolveRootDir(input), input.changeId, input.files);
      return { ok: true };
    }),

  deleteChange: publicProcedure
    .input(ROOT_INPUT.and(z.object({ changeId: z.string().min(1) })))
    .mutation(async ({ input }) => {
      await deleteChange(await resolveRootDir(input), input.changeId);
      return { ok: true };
    }),

  // ============ change deltas (specs/ inside a change) ============

  listChangeDeltas: publicProcedure
    .input(ROOT_INPUT.and(z.object({ changeId: z.string().min(1) })))
    .query(async ({ input }) => {
      return listChangeDeltas(await resolveRootDir(input), input.changeId);
    }),

  readChangeDelta: publicProcedure
    .input(
      ROOT_INPUT.and(
        z.object({
          changeId: z.string().min(1),
          capabilityId: z.string().min(1)
        })
      )
    )
    .query(async ({ input }) => {
      return readChangeDelta(await resolveRootDir(input), input.changeId, input.capabilityId);
    }),

  writeChangeDelta: publicProcedure
    .input(
      ROOT_INPUT.and(
        z.object({
          changeId: z.string().min(1),
          capabilityId: z.string().min(1),
          content: z.string()
        })
      )
    )
    .mutation(async ({ input }) => {
      await writeChangeDelta(await resolveRootDir(input), input.changeId, input.capabilityId, input.content);
      return { ok: true };
    }),

  deleteChangeDelta: publicProcedure
    .input(
      ROOT_INPUT.and(
        z.object({
          changeId: z.string().min(1),
          capabilityId: z.string().min(1)
        })
      )
    )
    .mutation(async ({ input }) => {
      await deleteChangeDelta(await resolveRootDir(input), input.changeId, input.capabilityId);
      return { ok: true };
    }),

  // ============ archived changes (read-only) ============

  listArchivedChanges: publicProcedure.input(ROOT_INPUT).query(async ({ input }) => {
    return listArchivedChanges(await resolveRootDir(input));
  }),

  readArchivedChange: publicProcedure
    .input(ROOT_INPUT.and(z.object({ archiveFolder: z.string().min(1) })))
    .query(async ({ input }) => {
      return readArchivedChange(await resolveRootDir(input), input.archiveFolder);
    }),

  readArchivedChangeFile: publicProcedure
    .input(
      ROOT_INPUT.and(
        z.object({
          archiveFolder: z.string().min(1),
          kind: FILE_KIND
        })
      )
    )
    .query(async ({ input }) => {
      return readArchivedChangeFile(await resolveRootDir(input), input.archiveFolder, input.kind);
    }),

  // ============ current specs (capabilities) ============

  listCapabilities: publicProcedure.input(ROOT_INPUT).query(async ({ input }) => {
    return listCapabilities(await resolveRootDir(input));
  }),

  readCapabilityFile: publicProcedure
    .input(
      ROOT_INPUT.and(
        z.object({
          capabilityId: z.string().min(1),
          kind: CAPABILITY_FILE_KIND
        })
      )
    )
    .query(async ({ input }) => {
      return readCapabilityFile(await resolveRootDir(input), input.capabilityId, input.kind);
    }),

  writeCapabilityFile: publicProcedure
    .input(
      ROOT_INPUT.and(
        z.object({
          capabilityId: z.string().min(1),
          kind: CAPABILITY_FILE_KIND,
          content: z.string()
        })
      )
    )
    .mutation(async ({ input }) => {
      await writeCapabilityFile(await resolveRootDir(input), input.capabilityId, input.kind, input.content);
      return { ok: true };
    }),

  // ============ project context ============

  readProjectContext: publicProcedure.input(ROOT_INPUT).query(async ({ input }) => {
    return readProjectContext(await resolveRootDir(input));
  }),

  // ============ sub-chat per change ============

  /**
   * Find or create a sub-chat bound to an OpenSpec change.
   * One sub-chat per (chatId, changeId) pair — reopening the same change
   * reuses the existing transcript.
   */
  openSubChatForChange: publicProcedure
    .input(
      z.object({
        chatId: z.string().min(1),
        projectId: z.string().min(1),
        changeId: z.string().min(1)
      })
    )
    .mutation(async ({ input }) => {
      const rootDir = await resolveRootDir({ chatId: input.chatId, projectId: input.projectId });
      const change = await readChange(rootDir, input.changeId);
      if (!change) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Change not found: ${input.changeId}` });
      }

      const db = getDatabase();

      const existing = db
        .select()
        .from(subChats)
        .where(and(eq(subChats.chatId, input.chatId), eq(subChats.openspecChangeId, input.changeId)))
        .get();

      if (existing) {
        if (existing.mode !== 'execute') {
          const updated = db
            .update(subChats)
            .set({ mode: 'execute' })
            .where(eq(subChats.id, existing.id))
            .returning()
            .get();
          console.log(
            `[openspec/router] openSubChatForChange changeId=${input.changeId} outcome=reused-mode-updated subChatId=${updated.id}`
          );
          return updated;
        }
        console.log(
          `[openspec/router] openSubChatForChange changeId=${input.changeId} outcome=reused subChatId=${existing.id}`
        );
        return existing;
      }

      const name = change.proposal?.title ?? input.changeId;

      // Promote the empty default sub-chat (created by chats.create) instead of
      // creating a second row — avoids having two sub-chats where the wrong one
      // (the empty default) gets auto-opened first.
      const defaultSubChat = db
        .select()
        .from(subChats)
        .where(and(eq(subChats.chatId, input.chatId), isNull(subChats.openspecChangeId)))
        .get();
      if (defaultSubChat) {
        const firstMessage = db
          .select({ id: messages.id })
          .from(messages)
          .where(eq(messages.subChatId, defaultSubChat.id))
          .limit(1)
          .get();
        if (!firstMessage) {
          const promoted = db
            .update(subChats)
            .set({ name, mode: 'execute', openspecChangeId: input.changeId })
            .where(eq(subChats.id, defaultSubChat.id))
            .returning()
            .get();
          console.log(
            `[openspec/router] openSubChatForChange changeId=${input.changeId} outcome=promoted-default subChatId=${promoted.id}`
          );
          return promoted;
        }
      }

      try {
        const created = db
          .insert(subChats)
          .values({
            chatId: input.chatId,
            name,
            mode: 'execute',
            openspecChangeId: input.changeId
          })
          .returning()
          .get();

        console.log(
          `[openspec/router] openSubChatForChange changeId=${input.changeId} outcome=created subChatId=${created.id}`
        );
        return created;
      } catch (err) {
        // Concurrent insert lost the race against the partial unique index on
        // (chat_id, openspec_change_id). Re-select and return the winner so
        // the caller still gets a stable sub-chat for this change.
        const message = err instanceof Error ? err.message : String(err);
        if (!/UNIQUE constraint failed/i.test(message)) throw err;
        const winner = db
          .select()
          .from(subChats)
          .where(and(eq(subChats.chatId, input.chatId), eq(subChats.openspecChangeId, input.changeId)))
          .get();
        if (!winner) throw err;
        console.log(
          `[openspec/router] openSubChatForChange changeId=${input.changeId} outcome=race-reused subChatId=${winner.id}`
        );
        return winner;
      }
    })
});
