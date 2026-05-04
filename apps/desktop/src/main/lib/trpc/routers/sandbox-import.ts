// Sandbox import removed — CodeSandbox integration no longer available.
// This router exists to satisfy renderer call sites; every procedure throws
// at runtime. Wire-in lives in `routers/index.ts` so the procedure shape is
// reachable from `trpc.sandboxImport.*` typings.
import { router, publicProcedure } from '../index';
import { z } from 'zod';

export const sandboxImportRouter = router({
  listRemoteSandboxChats: publicProcedure.query((): { chats: never[] } => ({ chats: [] })),
  cloneFromSandbox: publicProcedure
    .input(
      z.object({
        sandboxId: z.string(),
        remoteChatId: z.string(),
        remoteSubChatId: z.string().optional(),
        chatName: z.string().nullable().optional(),
        targetPath: z.string()
      })
    )
    .mutation((): { chatId: string } => {
      throw new Error('Sandbox import not supported in offline mode');
    }),
  importSandboxChat: publicProcedure
    .input(
      z.object({
        sandboxId: z.string(),
        remoteChatId: z.string(),
        remoteSubChatId: z.string().optional(),
        projectId: z.string(),
        chatName: z.string().nullable().optional()
      })
    )
    .mutation((): { chatId: string } => {
      throw new Error('Sandbox import not supported in offline mode');
    }),
  exportDebug: publicProcedure.input(z.object({ sandboxId: z.string() })).query((): never => {
    throw new Error('Sandbox export not supported in offline mode');
  })
});
