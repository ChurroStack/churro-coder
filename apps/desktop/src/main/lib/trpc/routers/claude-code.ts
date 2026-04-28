import { eq } from "drizzle-orm"
import { safeStorage, shell } from "electron"
import { z } from "zod"
import { getClaudeShellEnvironment } from "../../claude"
import {
  getExistingClaudeToken,
  isClaudeCliInstalled,
  runClaudeSetupToken,
} from "../../claude-token"
import {
  anthropicAccounts,
  anthropicSettings,
  claudeCodeCredentials,
  getDatabase,
} from "../../db"
import { createId } from "../../db/utils"
import { publicProcedure, router } from "../index"

/**
 * Encrypt token using Electron's safeStorage
 */
function encryptToken(token: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn("[ClaudeCode] Encryption not available, storing as base64")
    return Buffer.from(token).toString("base64")
  }
  return safeStorage.encryptString(token).toString("base64")
}

/**
 * Decrypt token using Electron's safeStorage
 */
function decryptToken(encrypted: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(encrypted, "base64").toString("utf-8")
  }
  const buffer = Buffer.from(encrypted, "base64")
  return safeStorage.decryptString(buffer)
}

/**
 * Store OAuth token - uses multi-account system
 * If setAsActive is true, also sets this account as active
 */
function storeOAuthToken(oauthToken: string, setAsActive = true): string {
  const encryptedToken = encryptToken(oauthToken)
  const db = getDatabase()
  const newId = createId()

  // Store in new multi-account table
  db.insert(anthropicAccounts)
    .values({
      id: newId,
      oauthToken: encryptedToken,
      displayName: "Anthropic Account",
      connectedAt: new Date(),
      desktopUserId: "user@local",
    })
    .run()

  if (setAsActive) {
    // Set as active account
    db.insert(anthropicSettings)
      .values({
        id: "singleton",
        activeAccountId: newId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: anthropicSettings.id,
        set: {
          activeAccountId: newId,
          updatedAt: new Date(),
        },
      })
      .run()
  }

  // Also update legacy table for backward compatibility
  db.delete(claudeCodeCredentials)
    .where(eq(claudeCodeCredentials.id, "default"))
    .run()

  db.insert(claudeCodeCredentials)
    .values({
      id: "default",
      oauthToken: encryptedToken,
      connectedAt: new Date(),
      userId: "user@local",
    })
    .run()

  return newId
}

// In-process sessions for local claude setup-token flow
interface LocalAuthSession {
  status: "waiting" | "ready" | "success" | "error"
  oauthUrl: string | null
  error: string | null
  // Resolves when the process completes and the token is stored
  done: Promise<void>
  // Resolver that lets submitCode signal the session is finished
  resolve: () => void
  reject: (err: Error) => void
}

const localSessions = new Map<string, LocalAuthSession>()

/**
 * Claude Code OAuth router for desktop
 * Auth flow uses local claude CLI subprocess — no remote sandbox
 */
export const claudeCodeRouter = router({
  /**
   * Check if user has existing CLI config (API key or proxy)
   * If true, user can skip OAuth onboarding
   * Based on PR #29 by @sa4hnd
   */
  hasExistingCliConfig: publicProcedure.query(() => {
    const shellEnv = getClaudeShellEnvironment()
    const hasConfig = !!(shellEnv.ANTHROPIC_API_KEY || shellEnv.ANTHROPIC_AUTH_TOKEN || shellEnv.ANTHROPIC_BASE_URL)
    return {
      hasConfig,
      hasApiKey: !!(shellEnv.ANTHROPIC_API_KEY || shellEnv.ANTHROPIC_AUTH_TOKEN),
      baseUrl: shellEnv.ANTHROPIC_BASE_URL || null,
    }
  }),

  /**
   * Check if user has Claude Code connected (local check)
   * Now uses multi-account system - checks for active account
   */
  getIntegration: publicProcedure.query(() => {
    const db = getDatabase()

    // First try multi-account system
    const settings = db
      .select()
      .from(anthropicSettings)
      .where(eq(anthropicSettings.id, "singleton"))
      .get()

    if (settings?.activeAccountId) {
      const account = db
        .select()
        .from(anthropicAccounts)
        .where(eq(anthropicAccounts.id, settings.activeAccountId))
        .get()

      if (account) {
        return {
          isConnected: true,
          connectedAt: account.connectedAt?.toISOString() ?? null,
          accountId: account.id,
          displayName: account.displayName,
        }
      }
    }

    // Fallback to legacy table
    const cred = db
      .select()
      .from(claudeCodeCredentials)
      .where(eq(claudeCodeCredentials.id, "default"))
      .get()

    return {
      isConnected: !!cred?.oauthToken,
      connectedAt: cred?.connectedAt?.toISOString() ?? null,
      accountId: null,
      displayName: null,
    }
  }),

  /**
   * Start OAuth flow - spawns local claude CLI subprocess
   * Returns a sessionId that pollStatus/submitCode use to track progress
   */
  startAuth: publicProcedure.mutation(async () => {
    if (!isClaudeCliInstalled()) {
      throw new Error(
        "Claude CLI is not installed. Install it with: brew install anthropic/claude/claude"
      )
    }

    const sessionId = createId()

    let resolveSession!: () => void
    let rejectSession!: (err: Error) => void
    const done = new Promise<void>((res, rej) => {
      resolveSession = res
      rejectSession = rej
    })

    const session: LocalAuthSession = {
      status: "waiting",
      oauthUrl: null,
      error: null,
      done,
      resolve: resolveSession,
      reject: rejectSession,
    }
    localSessions.set(sessionId, session)

    // Spawn claude setup-token in background; parse stdout for the OAuth URL
    runClaudeSetupToken((message) => {
      // Look for the OAuth authorization URL in the CLI output
      const urlMatch = message.match(/https:\/\/claude\.ai\/[^\s"'>]+/)
      if (urlMatch && session.status === "waiting") {
        session.oauthUrl = urlMatch[0]
        session.status = "ready"
      }
    }).then((result) => {
      if (result.success) {
        if (result.token) {
          storeOAuthToken(result.token)
        }
        session.status = "success"
        session.resolve()
      } else {
        session.status = "error"
        session.error = result.error ?? "Unknown error"
        session.reject(new Error(session.error))
      }
      // Clean up session after 5 minutes
      setTimeout(() => localSessions.delete(sessionId), 5 * 60 * 1000)
    })

    return { sandboxId: "local", sandboxUrl: "local", sessionId }
  }),

  /**
   * Poll for OAuth URL - checks local session state
   */
  pollStatus: publicProcedure
    .input(
      z.object({
        sandboxUrl: z.string(),
        sessionId: z.string(),
      })
    )
    .query(({ input }) => {
      const session = localSessions.get(input.sessionId)
      if (!session) {
        return { state: "error" as const, oauthUrl: null, error: "Session not found or expired" }
      }
      return {
        state: session.status as string,
        oauthUrl: session.oauthUrl,
        error: session.error,
      }
    }),

  /**
   * Submit OAuth code — re-reads the token from the system keychain after
   * the local claude CLI subprocess has already completed its own token exchange.
   * The code is not forwarded here; the CLI handles stdin itself.
   * This procedure just waits for the subprocess to finish and imports the token.
   */
  submitCode: publicProcedure
    .input(
      z.object({
        sandboxUrl: z.string(),
        sessionId: z.string(),
        code: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const session = localSessions.get(input.sessionId)
      if (!session) {
        throw new Error("Session not found or expired")
      }

      // If the session already succeeded (CLI read token from keychain), we're done
      if (session.status === "success") {
        localSessions.delete(input.sessionId)
        return { success: true }
      }

      if (session.status === "error") {
        localSessions.delete(input.sessionId)
        throw new Error(session.error ?? "Authentication failed")
      }

      // Wait for the subprocess to complete (max 60 seconds for token exchange)
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout waiting for authentication")), 60_000)
      )
      await Promise.race([session.done, timeout])

      if (session.status !== "success") {
        throw new Error(session.error ?? "Authentication failed")
      }

      localSessions.delete(input.sessionId)
      console.log("[ClaudeCode] Token stored locally via local CLI")
      return { success: true }
    }),

  /**
   * Import an existing OAuth token from the local machine
   */
  importToken: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const oauthToken = input.token.trim()

      storeOAuthToken(oauthToken)

      console.log("[ClaudeCode] Token imported locally")
      return { success: true }
    }),

  /**
   * Check for existing Claude token in system credentials
   */
  getSystemToken: publicProcedure.query(() => {
    const token = getExistingClaudeToken()?.trim() ?? null
    return { token }
  }),

  /**
   * Import Claude token from system credentials
   */
  importSystemToken: publicProcedure.mutation(() => {
    const token = getExistingClaudeToken()?.trim()
    if (!token) {
      throw new Error("No existing Claude token found")
    }

    storeOAuthToken(token)
    console.log("[ClaudeCode] Token imported from system")
    return { success: true }
  }),

  /**
   * Get decrypted OAuth token (local)
   * Now uses multi-account system - gets token from active account
   */
  getToken: publicProcedure.query(() => {
    const db = getDatabase()

    // First try multi-account system
    const settings = db
      .select()
      .from(anthropicSettings)
      .where(eq(anthropicSettings.id, "singleton"))
      .get()

    if (settings?.activeAccountId) {
      const account = db
        .select()
        .from(anthropicAccounts)
        .where(eq(anthropicAccounts.id, settings.activeAccountId))
        .get()

      if (account) {
        try {
          const token = decryptToken(account.oauthToken)
          return { token, error: null }
        } catch (error) {
          console.error("[ClaudeCode] Decrypt error:", error)
          return { token: null, error: "Failed to decrypt token" }
        }
      }
    }

    // Fallback to legacy table
    const cred = db
      .select()
      .from(claudeCodeCredentials)
      .where(eq(claudeCodeCredentials.id, "default"))
      .get()

    if (!cred?.oauthToken) {
      return { token: null, error: "Not connected" }
    }

    try {
      const token = decryptToken(cred.oauthToken)
      return { token, error: null }
    } catch (error) {
      console.error("[ClaudeCode] Decrypt error:", error)
      return { token: null, error: "Failed to decrypt token" }
    }
  }),

  /**
   * Disconnect - delete active account from multi-account system
   */
  disconnect: publicProcedure.mutation(() => {
    const db = getDatabase()

    // Get active account
    const settings = db
      .select()
      .from(anthropicSettings)
      .where(eq(anthropicSettings.id, "singleton"))
      .get()

    if (settings?.activeAccountId) {
      // Remove active account
      db.delete(anthropicAccounts)
        .where(eq(anthropicAccounts.id, settings.activeAccountId))
        .run()

      // Try to set another account as active
      const firstRemaining = db.select().from(anthropicAccounts).limit(1).get()

      if (firstRemaining) {
        db.update(anthropicSettings)
          .set({
            activeAccountId: firstRemaining.id,
            updatedAt: new Date(),
          })
          .where(eq(anthropicSettings.id, "singleton"))
          .run()
      } else {
        db.update(anthropicSettings)
          .set({
            activeAccountId: null,
            updatedAt: new Date(),
          })
          .where(eq(anthropicSettings.id, "singleton"))
          .run()
      }
    }

    // Also clear legacy table
    db.delete(claudeCodeCredentials)
      .where(eq(claudeCodeCredentials.id, "default"))
      .run()

    console.log("[ClaudeCode] Disconnected")
    return { success: true }
  }),

  /**
   * Open OAuth URL in browser
   */
  openOAuthUrl: publicProcedure
    .input(z.string())
    .mutation(async ({ input: url }) => {
      await shell.openExternal(url)
      return { success: true }
    }),
})
