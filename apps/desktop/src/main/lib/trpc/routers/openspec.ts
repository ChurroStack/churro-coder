import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { stat } from 'node:fs/promises';
import { router, publicProcedure } from '../index';
import { chats, getDatabase, projects } from '../../db';
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
  })
});
