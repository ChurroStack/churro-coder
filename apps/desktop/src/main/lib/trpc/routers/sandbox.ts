import { z } from "zod"
import { eq } from "drizzle-orm"
import { getDatabase, sandboxSettings, projects, chats } from "../../db"
import { publicProcedure, router } from "../index"
import {
  detectSandboxCapabilities,
  osSandboxAvailable,
  resolveSandboxPolicy,
} from "../../sandbox/policy"

export const sandboxRouter = router({
  getSettings: publicProcedure.query(async () => {
    const db = getDatabase()
    const settings = db
      .select()
      .from(sandboxSettings)
      .where(eq(sandboxSettings.id, "singleton"))
      .get()

    return (
      settings ?? {
        id: "singleton",
        sandboxEnabled: true,
        extraWritablePaths: "[]",
        extraDeniedPaths: "[]",
        allowToolchainCaches: true,
        updatedAt: null,
      }
    )
  }),

  setSettings: publicProcedure
    .input(
      z.object({
        sandboxEnabled: z.boolean().optional(),
        extraWritablePaths: z.string().optional(),
        extraDeniedPaths: z.string().optional(),
        allowToolchainCaches: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const existing = db
        .select()
        .from(sandboxSettings)
        .where(eq(sandboxSettings.id, "singleton"))
        .get()

      if (existing) {
        db.update(sandboxSettings)
          .set({
            ...(input.sandboxEnabled !== undefined && {
              sandboxEnabled: input.sandboxEnabled,
            }),
            ...(input.extraWritablePaths !== undefined && {
              extraWritablePaths: input.extraWritablePaths,
            }),
            ...(input.extraDeniedPaths !== undefined && {
              extraDeniedPaths: input.extraDeniedPaths,
            }),
            ...(input.allowToolchainCaches !== undefined && {
              allowToolchainCaches: input.allowToolchainCaches,
            }),
            updatedAt: new Date(),
          })
          .where(eq(sandboxSettings.id, "singleton"))
          .run()
      } else {
        db.insert(sandboxSettings)
          .values({
            id: "singleton",
            sandboxEnabled: input.sandboxEnabled ?? true,
            extraWritablePaths: input.extraWritablePaths ?? "[]",
            extraDeniedPaths: input.extraDeniedPaths ?? "[]",
            allowToolchainCaches: input.allowToolchainCaches ?? true,
            updatedAt: new Date(),
          })
          .run()
      }
      return { ok: true }
    }),

  getCapabilities: publicProcedure.query(async () => {
    const caps = detectSandboxCapabilities()
    return {
      ...caps,
      osSandboxAvailable: osSandboxAvailable(),
      platform: process.platform,
    }
  }),

  getStatus: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        cwd: z.string(),
        projectPath: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const policy = await resolveSandboxPolicy(
        input.chatId,
        input.cwd,
        input.projectPath ?? input.cwd,
      )
      return {
        enabled: policy.enabled,
        osSandboxAvailable: policy.osSandboxAvailable,
        degraded: policy.enabled && !policy.osSandboxAvailable,
      }
    }),

  setProjectOverride: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        sandboxEnabled: z.boolean().nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      db.update(projects)
        .set({ sandboxEnabled: input.sandboxEnabled })
        .where(eq(projects.id, input.projectId))
        .run()
      return { ok: true }
    }),

  setChatOverride: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        sandboxEnabled: z.boolean().nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      db.update(chats)
        .set({ sandboxEnabled: input.sandboxEnabled })
        .where(eq(chats.id, input.chatId))
        .run()
      return { ok: true }
    }),
})
