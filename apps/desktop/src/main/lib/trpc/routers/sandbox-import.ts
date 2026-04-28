// Sandbox import removed — CodeSandbox integration no longer available
import { router, publicProcedure } from "../index"
import { z } from "zod"

export const sandboxImportRouter = router({
  listRemoteSandboxChats: publicProcedure.query(() => ({ chats: [] })),
  cloneFromSandbox: publicProcedure
    .input(z.object({ remoteChatId: z.string(), remoteSubChatId: z.string().optional() }))
    .mutation(() => { throw new Error("Sandbox import not supported in offline mode") }),
  exportDebug: publicProcedure
    .input(z.object({ sandboxId: z.string() }))
    .query(() => { throw new Error("Sandbox export not supported in offline mode") }),
})
