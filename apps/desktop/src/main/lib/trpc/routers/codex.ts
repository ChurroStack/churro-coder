import {
  acpTools,
  createACPProvider,
  type ACPProvider,
} from "@mcpc-tech/acp-ai-provider"
import { observable } from "@trpc/server/observable"
import { stepCountIs, streamText, tool } from "ai"
import { eq } from "drizzle-orm"
import { app } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join, sep } from "node:path"
import { z } from "zod"
import {
  normalizeCodexAssistantMessage,
  normalizeCodexStreamChunk,
} from "../../../../shared/codex-tool-normalizer"
import { computeCatchupBlock } from "../../multi-provider/catchup"
import { getProviderForModelId } from "../../../../shared/provider-from-model"
import { getClaudeShellEnvironment } from "../../claude/env"
import { resolveProjectPathFromWorktree } from "../../claude-config"
import { getDatabase, projects as projectsTable, subChats } from "../../db"
import { computeFileStatsFromMessages } from "../../file-stats"
import {
  fetchMcpTools,
  fetchMcpToolsStdio,
  type McpToolInfo,
} from "../../mcp-auth"
import { publicProcedure, router } from "../index"
import {
  clearPendingApprovals,
  pendingToolApprovals,
} from "./tool-approvals"

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

const ASK_USER_QUESTION_TIMEOUT_MS = 60_000
const QUESTIONS_SKIPPED_MESSAGE = "User skipped questions - proceed with defaults"
const QUESTIONS_TIMED_OUT_MESSAGE = "Timed out"

const codexQuestionSchema = z.object({
  question: z.string().min(1),
  header: z.string().min(1),
  options: z
    .array(
      z.object({
        label: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .min(2),
  multiSelect: z.boolean().optional(),
})

const codexPlanStepSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  files: z.array(z.string()).optional(),
  estimatedComplexity: z.enum(["low", "medium", "high"]).optional(),
  status: z
    .enum(["pending", "in_progress", "completed", "skipped"])
    .optional(),
})

const codexPlanSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  summary: z.string().optional(),
  steps: z.array(codexPlanStepSchema),
  status: z.literal("awaiting_approval").optional(),
})

type CodexProviderSession = {
  provider: ACPProvider
  cwd: string
  authFingerprint: string | null
  mcpFingerprint: string
}

type CodexLoginSessionState =
  | "running"
  | "success"
  | "error"
  | "cancelled"

type CodexLoginSession = {
  id: string
  process: ChildProcess | null
  state: CodexLoginSessionState
  output: string
  url: string | null
  error: string | null
  exitCode: number | null
}

type CodexIntegrationState =
  | "connected_chatgpt"
  | "connected_api_key"
  | "not_logged_in"
  | "unknown"

type CodexMcpServerForSession =
  | {
      name: string
      type: "stdio"
      command: string
      args: string[]
      env: Array<{ name: string; value: string }>
    }
  | {
      name: string
      type: "http"
      url: string
      headers: Array<{ name: string; value: string }>
    }

type CodexMcpServerForSettings = {
  name: string
  status: "connected" | "failed" | "pending" | "needs-auth"
  tools: McpToolInfo[]
  needsAuth: boolean
  config: Record<string, unknown>
}

type CodexMcpSnapshot = {
  mcpServersForSession: CodexMcpServerForSession[]
  groups: Array<{
    groupName: string
    projectPath: string | null
    mcpServers: CodexMcpServerForSettings[]
  }>
  fingerprint: string
  fetchedAt: number
  toolsResolved: boolean
}

const providerSessions = new Map<string, CodexProviderSession>()
type ActiveCodexStream = {
  runId: string
  controller: AbortController
  cancelRequested: boolean
}

const activeStreams = new Map<string, ActiveCodexStream>()

/** Check if there are any active Codex streaming sessions */
export function hasActiveCodexStreams(): boolean {
  return activeStreams.size > 0
}

/** Abort all active Codex streams so their cleanup saves partial state */
export function abortAllCodexStreams(): void {
  for (const [subChatId, stream] of activeStreams) {
    console.log(`[codex] Aborting stream ${subChatId} before reload`)
    stream.controller.abort()
    clearPendingApprovals("Session ended.", subChatId)
  }
  activeStreams.clear()
}
const loginSessions = new Map<string, CodexLoginSession>()
const codexMcpCache = new Map<string, CodexMcpSnapshot>()

const URL_CANDIDATE_REGEX = /https?:\/\/[^\s]+/g
const ANSI_ESCAPE_REGEX = /\u001B\[[0-?]*[ -/]*[@-~]/g
const ANSI_OSC_REGEX = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g

const AUTH_HINTS = [
  "not logged in",
  "authentication required",
  "auth required",
  "login required",
  "missing credentials",
  "no credentials",
  "unauthorized",
  "forbidden",
  "codex login",
  "401",
  "403",
]
const DEFAULT_CODEX_MODEL = "gpt-5.4/high"
const CODEX_MCP_TOOLS_FETCH_TIMEOUT_MS = 40_000
const CODEX_USAGE_POLL_ATTEMPTS = 3
const CODEX_USAGE_POLL_INTERVAL_MS = 200

type CodexTokenUsage = {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  total_tokens?: number
}

type CodexTokenCountInfo = {
  last_token_usage?: CodexTokenUsage
  model_context_window?: number
}

type CodexUsageMetadata = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  modelContextWindow?: number
  totalCostUsd?: number
}

// Prices per 1M tokens (USD). Strip the "/thinking" suffix to get the base model ID.
// Sources: OpenAI API pricing page (April 2026).
const CODEX_MODEL_PRICING: Record<
  string,
  { inputPer1M: number; cachedInputPer1M: number; outputPer1M: number }
> = {
  "gpt-5.5":             { inputPer1M: 5.00,  cachedInputPer1M: 0.40,  outputPer1M: 30.00 },
  "gpt-5.4":             { inputPer1M: 2.50,  cachedInputPer1M: 0.25,  outputPer1M: 15.00 },
  "gpt-5.4-mini":        { inputPer1M: 0.75,  cachedInputPer1M: 0.075, outputPer1M:  4.50 },
  "gpt-5.3-codex":       { inputPer1M: 1.75,  cachedInputPer1M: 0.175, outputPer1M: 14.00 },
  "gpt-5.3-codex-spark": { inputPer1M: 1.75,  cachedInputPer1M: 0.175, outputPer1M: 14.00 },
  "gpt-5.2-codex":       { inputPer1M: 1.75,  cachedInputPer1M: 0.175, outputPer1M: 14.00 },
  "gpt-5.1-codex-max":   { inputPer1M: 1.25,  cachedInputPer1M: 0.125, outputPer1M: 10.00 },
  "gpt-5.1-codex-mini":  { inputPer1M: 0.25,  cachedInputPer1M: 0.025, outputPer1M:  2.00 },
}

const codexMcpListEntrySchema = z
  .object({
    name: z.string(),
    enabled: z.boolean(),
    disabled_reason: z.string().nullable().optional(),
    transport: z
      .object({
        type: z.string(),
        command: z.string().nullable().optional(),
        args: z.array(z.string()).nullable().optional(),
        env: z.record(z.string()).nullable().optional(),
        env_vars: z.array(z.string()).nullable().optional(),
        cwd: z.string().nullable().optional(),
        url: z.string().nullable().optional(),
        bearer_token_env_var: z.string().nullable().optional(),
        http_headers: z.record(z.string()).nullable().optional(),
        env_http_headers: z.record(z.string()).nullable().optional(),
      })
      .passthrough(),
    auth_status: z.string().nullable().optional(),
  })
  .passthrough()

type CodexMcpListEntry = z.infer<typeof codexMcpListEntrySchema>

function getCodexPackageName(): string {
  const platform = process.platform
  const arch = process.arch

  if (platform === "darwin") {
    if (arch === "arm64") return "@zed-industries/codex-acp-darwin-arm64"
    if (arch === "x64") return "@zed-industries/codex-acp-darwin-x64"
  }

  if (platform === "linux") {
    if (arch === "arm64") return "@zed-industries/codex-acp-linux-arm64"
    if (arch === "x64") return "@zed-industries/codex-acp-linux-x64"
  }

  if (platform === "win32") {
    if (arch === "arm64") return "@zed-industries/codex-acp-win32-arm64"
    if (arch === "x64") return "@zed-industries/codex-acp-win32-x64"
  }

  throw new Error(`Unsupported platform/arch for codex-acp: ${platform}/${arch}`)
}

function toUnpackedAsarPath(filePath: string): string {
  const unpackedPath = filePath.replace(
    `${sep}app.asar${sep}`,
    `${sep}app.asar.unpacked${sep}`,
  )

  if (unpackedPath !== filePath && existsSync(unpackedPath)) {
    return unpackedPath
  }

  return filePath
}

function resolveCodexAcpBinaryPath(): string {
  const packageName = getCodexPackageName()
  const binaryName = process.platform === "win32" ? "codex-acp.exe" : "codex-acp"
  const codexPackageRoot = dirname(
    require.resolve("@zed-industries/codex-acp/package.json"),
  )
  const resolvedPath = require.resolve(`${packageName}/bin/${binaryName}`, {
    // Resolve relative to the wrapper package so nested optional deps work in packaged apps.
    paths: [codexPackageRoot],
  })

  return toUnpackedAsarPath(resolvedPath)
}

function resolveBundledCodexCliPath(): string {
  const binaryName = process.platform === "win32" ? "codex.exe" : "codex"
  const resourcesDir = app.isPackaged
    ? join(process.resourcesPath, "bin")
    : join(
        app.getAppPath(),
        "resources",
        "bin",
        `${process.platform}-${process.arch}`,
      )

  const binaryPath = join(resourcesDir, binaryName)
  if (existsSync(binaryPath)) {
    return binaryPath
  }

  const hint = app.isPackaged
    ? "Binary is missing from bundled resources."
    : "Run `bun run codex:download` to download it for local dev."

  throw new Error(
    `[codex] Bundled Codex CLI not found at ${binaryPath}. ${hint}`,
  )
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_OSC_REGEX, "").replace(ANSI_ESCAPE_REGEX, "")
}

function isLocalhostHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.endsWith(".localhost")
  )
}

function extractFirstNonLocalhostUrl(output: string): string | null {
  const matches = stripAnsi(output).match(URL_CANDIDATE_REGEX)
  if (!matches) return null

  for (const match of matches) {
    try {
      const parsedUrl = new URL(match.trim().replace(/[),.;!?]+$/, ""))
      if (!isLocalhostHostname(parsedUrl.hostname)) {
        return parsedUrl.toString()
      }
    } catch {
      // Ignore invalid URL candidates.
    }
  }

  return null
}

function appendLoginOutput(session: CodexLoginSession, chunk: string): void {
  const cleanChunk = stripAnsi(chunk)
  if (!cleanChunk) return

  session.output += cleanChunk

  if (!session.url) {
    session.url = extractFirstNonLocalhostUrl(session.output)
  }
}

function toLoginSessionResponse(session: CodexLoginSession) {
  return {
    sessionId: session.id,
    state: session.state,
    url: session.url,
    output: session.output,
    error: session.error,
    exitCode: session.exitCode,
  }
}

function getActiveLoginSession(): CodexLoginSession | null {
  for (const session of loginSessions.values()) {
    if (session.state === "running" && session.process && !session.process.killed) {
      return session
    }
  }

  return null
}

function extractCodexError(error: unknown): { message: string; code?: string } {
  const anyError = error as any
  const message =
    anyError?.data?.message ||
    anyError?.errorText ||
    anyError?.message ||
    anyError?.error ||
    String(error)
  const code = anyError?.data?.code || anyError?.code

  return {
    message: typeof message === "string" ? message : String(message),
    code: typeof code === "string" ? code : undefined,
  }
}

function isCodexAuthError(params: {
  message?: string | null
  code?: string | null
}): boolean {
  const searchableText = `${params.code || ""} ${params.message || ""}`.toLowerCase()
  return AUTH_HINTS.some((hint) => searchableText.includes(hint))
}

type RunCodexCliOptions = {
  cwd?: string
}

async function runCodexCli(
  args: string[],
  options?: RunCodexCliOptions,
): Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
}> {
  const codexCliPath = resolveBundledCodexCliPath()
  const cwd = options?.cwd?.trim()

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(codexCliPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: cwd && cwd.length > 0 ? cwd : undefined,
      env: process.env,
      windowsHide: true,
    })

    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8")
    })

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8")
    })

    child.once("error", (error) => {
      rejectPromise(
        new Error(
          `[codex] Failed to execute \`codex ${args.join(" ")}\`: ${error.message}`,
        ),
      )
    })

    child.once("close", (exitCode) => {
      resolvePromise({
        stdout: stripAnsi(stdout),
        stderr: stripAnsi(stderr),
        exitCode,
      })
    })
  })
}

async function runCodexCliChecked(
  args: string[],
  options?: RunCodexCliOptions,
): Promise<{
  stdout: string
  stderr: string
}> {
  const result = await runCodexCli(args, options)
  if (result.exitCode === 0) {
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    }
  }

  const message =
    result.stderr.trim() ||
    result.stdout.trim() ||
    `Codex command failed with exit code ${result.exitCode ?? "unknown"}`
  throw new Error(message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function toNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined
  }
  return Math.trunc(value)
}

function toTimestampMs(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    return undefined
  }
  return parsed
}

function resolveSessionsRoot(): string {
  // Match provider env precedence: shell-derived env overrides process.env.
  const shellCodexHome = getClaudeShellEnvironment().CODEX_HOME?.trim()
  if (shellCodexHome) {
    return join(shellCodexHome, "sessions")
  }

  const processCodexHome = process.env.CODEX_HOME?.trim()
  if (processCodexHome) {
    return join(processCodexHome, "sessions")
  }

  return join(homedir(), ".codex", "sessions")
}

async function findSessionFileById(sessionId: string): Promise<string | null> {
  const sessionsRoot = resolveSessionsRoot()
  const fileSuffix = `-${sessionId}.jsonl`
  const sortDesc = (values: string[]) =>
    values.sort((left, right) =>
      right.localeCompare(left, undefined, { numeric: true }),
    )
  const listNames = async (dirPath: string): Promise<string[]> => {
    try {
      return await readdir(dirPath, { encoding: "utf8" })
    } catch {
      return []
    }
  }
  const years = sortDesc(
    (await listNames(sessionsRoot)).filter((name) => /^\d{4}$/.test(name)),
  )

  for (const year of years) {
    const yearPath = join(sessionsRoot, year)
    const months = sortDesc(
      (await listNames(yearPath)).filter((name) => /^\d{2}$/.test(name)),
    )
    for (const month of months) {
      const monthPath = join(yearPath, month)
      const days = sortDesc(
        (await listNames(monthPath)).filter((name) => /^\d{2}$/.test(name)),
      )
      for (const day of days) {
        const dayPath = join(monthPath, day)
        const fileName = (await listNames(dayPath)).find((name) =>
          name.endsWith(fileSuffix),
        )
        if (fileName) {
          return join(dayPath, fileName)
        }
      }
    }
  }

  return null
}

async function readLatestTokenCountInfo(
  filePath: string,
  options?: { notBeforeTimestampMs?: number },
): Promise<CodexTokenCountInfo | null> {
  let rawContent = ""
  try {
    rawContent = await readFile(filePath, "utf8")
  } catch {
    return null
  }

  const lines = rawContent.split("\n")
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const rawLine = lines[index]?.trim()
    if (!rawLine) continue

    let parsedLine: any
    try {
      parsedLine = JSON.parse(rawLine)
    } catch {
      continue
    }

    if (
      parsedLine?.type !== "event_msg" ||
      parsedLine?.payload?.type !== "token_count"
    ) {
      continue
    }

    const eventTimestampMs = toTimestampMs(parsedLine?.timestamp)
    const notBeforeTimestampMs = options?.notBeforeTimestampMs
    if (
      notBeforeTimestampMs !== undefined &&
      (eventTimestampMs === undefined || eventTimestampMs < notBeforeTimestampMs)
    ) {
      continue
    }

    const rawInfo = parsedLine.payload?.info
    if (!rawInfo || typeof rawInfo !== "object") continue

    const rawTokenUsage = (rawInfo as any).last_token_usage
    let lastTokenUsage: CodexTokenUsage | undefined
    if (rawTokenUsage && typeof rawTokenUsage === "object") {
      const tokenUsage = rawTokenUsage as any
      const parsedTokenUsage: CodexTokenUsage = {
        input_tokens: toNonNegativeInt(tokenUsage.input_tokens),
        cached_input_tokens: toNonNegativeInt(tokenUsage.cached_input_tokens),
        output_tokens: toNonNegativeInt(tokenUsage.output_tokens),
        total_tokens: toNonNegativeInt(tokenUsage.total_tokens),
      }
      if (Object.values(parsedTokenUsage).some((tokenCount) => tokenCount !== undefined)) {
        lastTokenUsage = parsedTokenUsage
      }
    }

    const modelContextWindow = toNonNegativeInt(
      (rawInfo as any).model_context_window,
    )

    const info: CodexTokenCountInfo = {
      last_token_usage: lastTokenUsage,
      model_context_window: modelContextWindow,
    }
    if (!info.last_token_usage && info.model_context_window === undefined) continue

    return info
  }

  return null
}

function mapToUsageMetadata(
  info: CodexTokenCountInfo,
  modelId?: string,
): CodexUsageMetadata | null {
  const perMessageUsage = info.last_token_usage

  if (!perMessageUsage && info.model_context_window === undefined) {
    return null
  }

  const rawInputTokens = perMessageUsage?.input_tokens
  const cachedInputTokens = perMessageUsage?.cached_input_tokens ?? 0
  const inputTokens =
    rawInputTokens !== undefined
      ? Math.max(0, rawInputTokens - cachedInputTokens)
      : undefined
  const outputTokens = perMessageUsage?.output_tokens
  const totalTokens =
    perMessageUsage?.total_tokens ??
    (rawInputTokens !== undefined || outputTokens !== undefined
      ? (rawInputTokens ?? 0) + (outputTokens ?? 0)
      : undefined)

  const usageMetadata: CodexUsageMetadata = {}
  if (inputTokens !== undefined) usageMetadata.inputTokens = inputTokens
  if (outputTokens !== undefined) usageMetadata.outputTokens = outputTokens
  if (totalTokens !== undefined) usageMetadata.totalTokens = totalTokens
  if (info.model_context_window !== undefined) {
    usageMetadata.modelContextWindow = info.model_context_window
  }

  // Compute cost when pricing is available for this model.
  // The ACP model ID uses "baseModel/thinkingLevel" format; strip the suffix.
  const baseModelId = modelId?.split("/")[0] ?? ""
  const pricing = CODEX_MODEL_PRICING[baseModelId]
  if (pricing && rawInputTokens !== undefined && outputTokens !== undefined) {
    const billableInput = Math.max(0, rawInputTokens - cachedInputTokens)
    usageMetadata.totalCostUsd =
      (billableInput * pricing.inputPer1M +
        cachedInputTokens * pricing.cachedInputPer1M +
        outputTokens * pricing.outputPer1M) /
      1_000_000
  }

  return Object.keys(usageMetadata).length > 0 ? usageMetadata : null
}

async function pollUsage(
  sessionId: string,
  options?: { notBeforeTimestampMs?: number; modelId?: string },
): Promise<CodexUsageMetadata | null> {
  let sessionFilePath: string | null = null

  for (let attempt = 0; attempt < CODEX_USAGE_POLL_ATTEMPTS; attempt += 1) {
    if (!sessionFilePath) {
      sessionFilePath = await findSessionFileById(sessionId)
    }

    if (sessionFilePath) {
      const latestInfo = await readLatestTokenCountInfo(sessionFilePath, options)
      if (latestInfo) {
        const usageMetadata = mapToUsageMetadata(latestInfo, options?.modelId)
        if (usageMetadata) {
          return usageMetadata
        }
      }
    }

    if (attempt < CODEX_USAGE_POLL_ATTEMPTS - 1) {
      await sleep(CODEX_USAGE_POLL_INTERVAL_MS)
    }
  }

  return null
}

function getCodexMcpAuthState(authStatus: string | null | undefined): {
  supportsAuth: boolean
  authenticated: boolean
  needsAuth: boolean
} {
  const normalized = (authStatus || "").trim().toLowerCase()

  // Exact CLI values from codex-rs/protocol/src/protocol.rs (McpAuthStatus):
  // unsupported | not_logged_in | bearer_token | o_auth
  switch (normalized) {
    case "":
    case "none":
    case "unsupported":
      return { supportsAuth: false, authenticated: false, needsAuth: false }
    case "not_logged_in":
      return { supportsAuth: true, authenticated: false, needsAuth: true }
    case "bearer_token":
    case "o_auth":
      return { supportsAuth: true, authenticated: true, needsAuth: false }
    default:
      // Unknown/forward-compatible value: don't force needs-auth.
      return { supportsAuth: true, authenticated: false, needsAuth: false }
  }
}

function objectToPairs(
  value: Record<string, string> | null | undefined,
): Array<{ name: string; value: string }> | undefined {
  if (!value) return undefined
  const pairs = Object.entries(value)
    .filter(([name, val]) => typeof name === "string" && typeof val === "string")
    .map(([name, val]) => ({ name, value: val }))

  return pairs.length > 0 ? pairs : undefined
}

function resolveCodexStdioEnv(
  transport: CodexMcpListEntry["transport"],
): Record<string, string> | undefined {
  const merged: Record<string, string> = {}

  if (transport.env) {
    for (const [name, value] of Object.entries(transport.env)) {
      if (typeof name === "string" && typeof value === "string") {
        merged[name] = value
      }
    }
  }

  if (Array.isArray(transport.env_vars)) {
    for (const envName of transport.env_vars) {
      const value = process.env[envName]
      if (typeof value === "string" && value.length > 0 && !merged[envName]) {
        merged[envName] = value
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

function resolveCodexHttpHeaders(
  transport: CodexMcpListEntry["transport"],
): Record<string, string> | undefined {
  const merged: Record<string, string> = {}

  if (transport.http_headers) {
    for (const [name, value] of Object.entries(transport.http_headers)) {
      if (typeof name === "string" && typeof value === "string") {
        merged[name] = value
      }
    }
  }

  if (transport.env_http_headers) {
    for (const [headerName, envName] of Object.entries(transport.env_http_headers)) {
      if (typeof headerName !== "string" || typeof envName !== "string") continue
      const value = process.env[envName]
      if (typeof value === "string" && value.length > 0) {
        merged[headerName] = value
      }
    }
  }

  const bearerEnvVar = transport.bearer_token_env_var?.trim()
  if (bearerEnvVar && !merged.Authorization) {
    const token = process.env[bearerEnvVar]?.trim()
    if (token) {
      merged.Authorization = `Bearer ${token}`
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

function normalizeCodexTools(tools: McpToolInfo[]): McpToolInfo[] {
  const unique = new Map<string, McpToolInfo>()
  for (const tool of tools) {
    if (typeof tool?.name === "string" && tool.name.trim()) {
      const name = tool.name.trim()
      unique.set(name, {
        name,
        ...(tool.description ? { description: tool.description } : {}),
      })
    }
  }
  return [...unique.values()]
}

async function fetchCodexMcpTools(entry: CodexMcpListEntry): Promise<McpToolInfo[]> {
  const transportType = entry.transport.type.trim().toLowerCase()
  const timeoutPromise = new Promise<McpToolInfo[]>((_, reject) =>
    setTimeout(() => reject(new Error("Timeout")), CODEX_MCP_TOOLS_FETCH_TIMEOUT_MS),
  )

  const fetchPromise = (async (): Promise<McpToolInfo[]> => {
    if (transportType === "stdio") {
      const command = entry.transport.command?.trim()
      if (!command) return []
      return await fetchMcpToolsStdio({
        command,
        args: entry.transport.args || undefined,
        env: resolveCodexStdioEnv(entry.transport),
      })
    }

    if (
      transportType === "streamable_http" ||
      transportType === "http" ||
      transportType === "sse"
    ) {
      const url = entry.transport.url?.trim()
      if (!url) return []
      return await fetchMcpTools(url, resolveCodexHttpHeaders(entry.transport))
    }

    return []
  })()

  try {
    const tools = await Promise.race([fetchPromise, timeoutPromise])
    return normalizeCodexTools(tools)
  } catch {
    return []
  }
}

function resolveCodexLookupPath(pathCandidate: string | null | undefined): string {
  return pathCandidate && pathCandidate.trim() ? pathCandidate.trim() : "__global__"
}

function getCodexMcpFingerprint(servers: CodexMcpServerForSession[]): string {
  return createHash("sha256").update(JSON.stringify(servers)).digest("hex")
}

async function resolveCodexMcpSnapshot(params: {
  lookupPath?: string | null
  forceRefresh?: boolean
  includeTools?: boolean
}): Promise<CodexMcpSnapshot> {
  const lookupPath = resolveCodexLookupPath(params.lookupPath)
  const cached = codexMcpCache.get(lookupPath)
  const shouldIncludeTools = Boolean(params.includeTools)
  if (
    cached &&
    !params.forceRefresh &&
    (!shouldIncludeTools || cached.toolsResolved)
  ) {
    return cached
  }

  const result = await runCodexCliChecked(["mcp", "list", "--json"], {
    cwd: lookupPath === "__global__" ? undefined : lookupPath,
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    throw new Error("Failed to parse Codex MCP list JSON output.")
  }

  const entries = z.array(codexMcpListEntrySchema).parse(parsed)
  const mcpServersForSession: CodexMcpServerForSession[] = []
  const mcpServersForSettings: CodexMcpServerForSettings[] = []

  const convertedEntries = await Promise.all(
    entries.map(async (entry) => {
      const transportType = entry.transport.type.trim().toLowerCase()
      const authState = getCodexMcpAuthState(entry.auth_status)
      const includeInSession = entry.enabled
      const resolvedStdioEnv = resolveCodexStdioEnv(entry.transport)
      const resolvedHttpHeaders = resolveCodexHttpHeaders(entry.transport)
      let status: CodexMcpServerForSettings["status"] = !entry.enabled
        ? "failed"
        : authState.needsAuth
          ? "needs-auth"
          : "connected"

      const settingsConfig: Record<string, unknown> = {
        transportType: entry.transport.type,
        authStatus: entry.auth_status ?? "unknown",
        enabled: entry.enabled,
        disabledReason: entry.disabled_reason ?? undefined,
      }

      let sessionServer: CodexMcpServerForSession | null = null
      if (transportType === "stdio") {
        const command = entry.transport.command || undefined
        const args = entry.transport.args || undefined
        if (includeInSession && command) {
          const envPairs = objectToPairs(resolvedStdioEnv) || []
          sessionServer = {
            name: entry.name,
            type: "stdio",
            command,
            args: Array.isArray(args) ? args : [],
            env: envPairs,
          }
        }

        settingsConfig.command = command
        settingsConfig.args = args
        settingsConfig.env = entry.transport.env || undefined
        settingsConfig.envVars = entry.transport.env_vars || undefined
      } else if (
        transportType === "streamable_http" ||
        transportType === "http" ||
        transportType === "sse"
      ) {
        const url = entry.transport.url || undefined
        const headers = objectToPairs(resolvedHttpHeaders)
        if (includeInSession && url) {
          sessionServer = {
            name: entry.name,
            type: "http",
            url,
            headers: headers || [],
          }
        }

        settingsConfig.url = url
        settingsConfig.headers = entry.transport.http_headers || undefined
        settingsConfig.envHttpHeaders = entry.transport.env_http_headers || undefined
        settingsConfig.bearerTokenEnvVar =
          entry.transport.bearer_token_env_var || undefined
      }

      const shouldProbeTools =
        shouldIncludeTools &&
        includeInSession &&
        !authState.needsAuth &&
        (
          // Probe unauthenticated/public servers and stdio servers.
          !authState.supportsAuth ||
          transportType === "stdio" ||
          // For auth-capable HTTP, only probe if explicit auth header is available.
          Boolean(resolvedHttpHeaders?.Authorization)
        )
      const tools = shouldProbeTools ? await fetchCodexMcpTools(entry) : []
      if (shouldProbeTools && tools.length === 0) {
        status = "failed"
      }

      return {
        sessionServer,
        settingsServer: {
          name: entry.name,
          status,
          tools,
          needsAuth: authState.needsAuth,
          config: settingsConfig,
        } satisfies CodexMcpServerForSettings,
      }
    }),
  )

  for (const converted of convertedEntries) {
    if (converted.sessionServer) {
      mcpServersForSession.push(converted.sessionServer)
    }
    mcpServersForSettings.push(converted.settingsServer)
  }

  const snapshot: CodexMcpSnapshot = {
    mcpServersForSession,
    groups: [
      {
        groupName: "Global",
        projectPath: null,
        mcpServers: mcpServersForSettings,
      },
    ],
    fingerprint: getCodexMcpFingerprint(mcpServersForSession),
    fetchedAt: Date.now(),
    toolsResolved: shouldIncludeTools,
  }

  codexMcpCache.set(lookupPath, snapshot)
  return snapshot
}

function clearCodexMcpCache(): void {
  codexMcpCache.clear()
}

function getCodexServerIdentity(
  server: CodexMcpServerForSettings,
): string {
  const config = server.config as Record<string, unknown>
  return JSON.stringify({
    enabled: config.enabled ?? null,
    disabledReason: config.disabledReason ?? null,
    transportType: config.transportType ?? null,
    command: config.command ?? null,
    args: config.args ?? null,
    env: config.env ?? null,
    envVars: config.envVars ?? null,
    url: config.url ?? null,
    headers: config.headers ?? null,
    envHttpHeaders: config.envHttpHeaders ?? null,
    bearerTokenEnvVar: config.bearerTokenEnvVar ?? null,
    authStatus: config.authStatus ?? null,
  })
}

export async function getAllCodexMcpConfigHandler() {
  const globalSnapshot = await resolveCodexMcpSnapshot({ includeTools: true })
  const globalServers = globalSnapshot.groups[0]?.mcpServers || []
  const globalByName = new Map(
    globalServers.map((server) => [server.name, getCodexServerIdentity(server)]),
  )

  const groups: CodexMcpSnapshot["groups"] = [...globalSnapshot.groups]

  // Only enumerate projects the app knows about (DB-backed projects).
  // Do not scan ~/.codex/config.toml project entries.
  const projectPathSet = new Set<string>()

  try {
    const db = getDatabase()
    const dbProjects = db.select({ path: projectsTable.path }).from(projectsTable).all()
    for (const project of dbProjects) {
      if (typeof project.path === "string" && project.path.trim().length > 0) {
        projectPathSet.add(project.path)
      }
    }
  } catch (error) {
    console.error("[codex.getAllMcpConfig] Failed to read projects from DB:", error)
  }

  const projectPaths = [...projectPathSet].sort((a, b) => a.localeCompare(b))
  const projectResults = await Promise.allSettled(
    projectPaths.map(async (projectPath) => {
      const projectSnapshot = await resolveCodexMcpSnapshot({
        lookupPath: projectPath,
        includeTools: true,
      })
      const effectiveServers = projectSnapshot.groups[0]?.mcpServers || []
      const projectOnlyServers = effectiveServers.filter((server) => {
        const globalIdentity = globalByName.get(server.name)
        if (!globalIdentity) return true
        return globalIdentity !== getCodexServerIdentity(server)
      })

      if (projectOnlyServers.length === 0) {
        return null
      }

      return {
        groupName: basename(projectPath) || projectPath,
        projectPath,
        mcpServers: projectOnlyServers,
      }
    }),
  )

  for (const result of projectResults) {
    if (result.status === "fulfilled" && result.value) {
      groups.push(result.value)
      continue
    }
    if (result.status === "rejected") {
      console.error("[codex.getAllMcpConfig] Failed to resolve project MCP snapshot:", result.reason)
    }
  }

  return { groups }
}

function normalizeCodexIntegrationState(rawOutput: string): CodexIntegrationState {
  const normalizedOutput = rawOutput.toLowerCase()

  if (normalizedOutput.includes("logged in using chatgpt")) {
    return "connected_chatgpt"
  }

  if (
    normalizedOutput.includes("logged in using an api key") ||
    normalizedOutput.includes("logged in using api key")
  ) {
    return "connected_api_key"
  }

  if (normalizedOutput.includes("not logged in")) {
    return "not_logged_in"
  }

  return "unknown"
}

function parseStoredMessages(raw: string | null | undefined): any[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function extractPromptFromStoredMessage(message: any): string {
  if (!message || !Array.isArray(message.parts)) return ""

  const textParts: string[] = []
  const fileContents: string[] = []

  for (const part of message.parts) {
    if (part?.type === "text" && typeof part.text === "string") {
      textParts.push(part.text)
    } else if (part?.type === "file-content") {
      const filePath =
        typeof part.filePath === "string" ? part.filePath : undefined
      const fileName = filePath?.split("/").pop() || filePath || "file"
      const content = typeof part.content === "string" ? part.content : ""
      fileContents.push(`\n--- ${fileName} ---\n${content}`)
    }
  }

  return textParts.join("\n") + fileContents.join("")
}

function getLastSessionId(messages: any[]): string | undefined {
  // Only resume a Codex session — skip assistant messages from Claude or other
  // providers to avoid passing a Claude session UUID to the ACP server which
  // would return "Resource not found".
  const lastCodexAssistant = [...messages].reverse().find(
    (message) =>
      message?.role === "assistant" &&
      getProviderForModelId(message?.metadata?.model) === "codex",
  )
  const sessionId = lastCodexAssistant?.metadata?.sessionId
  return typeof sessionId === "string" ? sessionId : undefined
}

function extractCodexModelId(rawModel: unknown): string | undefined {
  if (typeof rawModel !== "string" || rawModel.length === 0) {
    return undefined
  }

  const normalizedModel = rawModel.trim()

  if (!normalizedModel || normalizedModel === "codex") {
    return undefined
  }

  return normalizedModel
}

function preprocessCodexModelName(params: {
  modelId: string
  authConfig?: { apiKey: string }
}): string {
  const hasAppManagedApiKey = Boolean(params.authConfig?.apiKey?.trim())
  if (!hasAppManagedApiKey) {
    return params.modelId
  }

  // All model IDs now match the real API; pass through as-is
  return params.modelId
}

function getAuthFingerprint(authConfig?: { apiKey: string }): string | null {
  const apiKey = authConfig?.apiKey?.trim()
  if (!apiKey) return null
  return createHash("sha256").update(apiKey).digest("hex")
}

function buildCodexProviderEnv(authConfig?: { apiKey: string }): Record<string, string> {
  // Prefer shell-derived values (notably PATH) so stdio MCP dependencies
  // like pipx/npx resolve the same way as in MCP tool probing.
  const env: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value
    }
  }

  const shellEnv = getClaudeShellEnvironment()
  for (const [key, value] of Object.entries(shellEnv)) {
    if (typeof value === "string") {
      env[key] = value
    }
  }

  const apiKey = authConfig?.apiKey?.trim()
  if (!apiKey) {
    return env
  }

  return {
    ...env,
    CODEX_API_KEY: apiKey,
  }
}

function getCodexAuthMethodId(authConfig?: {
  apiKey: string
}): "codex-api-key" | undefined {
  const apiKey = authConfig?.apiKey?.trim()
  if (!apiKey) {
    return undefined
  }

  // codex-acp advertises auth methods:
  // - chatgpt
  // - codex-api-key
  // - openai-api-key
  // For app-managed API key path we want deterministic key auth.
  return "codex-api-key"
}

function buildUserParts(
  prompt: string,
  images:
    | Array<{
        base64Data?: string
        mediaType?: string
        filename?: string
      }>
    | undefined,
): any[] {
  const parts: any[] = [{ type: "text", text: prompt }]

  if (images && images.length > 0) {
    for (const image of images) {
      if (!image.base64Data || !image.mediaType) continue
      parts.push({
        type: "data-image",
        data: {
          base64Data: image.base64Data,
          mediaType: image.mediaType,
          filename: image.filename,
        },
      })
    }
  }

  return parts
}

function buildModelMessageContent(
  prompt: string,
  images:
    | Array<{
        base64Data?: string
        mediaType?: string
        filename?: string
      }>
    | undefined,
): any[] {
  const content: any[] = [{ type: "text", text: prompt }]

  if (images && images.length > 0) {
    for (const image of images) {
      if (!image.base64Data || !image.mediaType) continue
      content.push({
        type: "file",
        mediaType: image.mediaType,
        data: image.base64Data,
        ...(image.filename ? { filename: image.filename } : {}),
      })
    }
  }

  return content
}

function normalizeCodexQuestions(
  questions: z.infer<typeof codexQuestionSchema>[],
) {
  return questions.map((question) => ({
    question: question.question,
    header: question.header,
    options: question.options.map((option) => ({
      label: option.label,
      description: option.description || "",
    })),
    multiSelect: Boolean(question.multiSelect),
  }))
}

function normalizeCodexPlan(plan: z.infer<typeof codexPlanSchema>) {
  return {
    ...plan,
    id: plan.id || `plan-${Date.now()}`,
    status: "awaiting_approval" as const,
    steps: plan.steps.map((step, index) => ({
      ...step,
      id: step.id || `step-${index + 1}`,
      status: step.status || "pending",
    })),
  }
}

function toMcpToolResult(result: unknown) {
  const contentText =
    typeof result === "string" ? result : JSON.stringify(result)

  return {
    content: [
      {
        type: "text" as const,
        text: contentText,
      },
    ],
  }
}

function getAssistantText(message: any): string {
  if (!message || !Array.isArray(message.parts)) return ""
  return message.parts
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
}

function isCodexPlanWritePart(part: any): boolean {
  const inputToolName =
    typeof part?.input?.toolName === "string" ? part.input.toolName : ""
  return (
    part?.type === "tool-PlanWrite" ||
    part?.toolName === "PlanWrite" ||
    inputToolName === "PlanWrite" ||
    inputToolName.startsWith("PlanWrite ") ||
    inputToolName.endsWith("/PlanWrite")
  )
}

function parseMcpContentJson(value: any): any | null {
  const content = Array.isArray(value?.content) ? value.content : []
  const firstText = content.find((item: any) => typeof item?.text === "string")
  if (!firstText?.text) return null

  try {
    return JSON.parse(firstText.text)
  } catch {
    return null
  }
}

function getPlanFromPlanWritePart(part: any): any | null {
  const candidates = [
    part?.input?.plan,
    part?.input?.args?.plan,
    part?.output?.plan,
    part?.result?.plan,
    part?.output?.structuredContent?.plan,
    part?.result?.structuredContent?.plan,
    parseMcpContentJson(part?.output)?.plan,
    parseMcpContentJson(part?.result)?.plan,
  ]

  return candidates.find((plan) => plan && typeof plan === "object") || null
}

function hasUsableCodexPlanWritePart(message: any): boolean {
  if (!message || !Array.isArray(message.parts)) return false
  return message.parts.some((part: any) => {
    if (!isCodexPlanWritePart(part)) return false
    if (part.state === "output-error") return false
    if (part.errorText || part.error) return false

    const plan = getPlanFromPlanWritePart(part)
    if (!plan) return false

    return part.output !== undefined || part.result !== undefined
  })
}

function findPlanFromAnyPlanWritePart(message: any): any | null {
  if (!message || !Array.isArray(message.parts)) return null

  for (const part of message.parts) {
    if (!isCodexPlanWritePart(part)) continue
    const plan = getPlanFromPlanWritePart(part)
    if (plan) return plan
  }

  return null
}

function extractPlanStepTitles(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const steps: string[] = []

  for (const line of lines) {
    const match = line.match(/^(?:\d+[\).\:-]|\-|\*)\s+(.+)$/)
    if (!match) continue

    const title = match[1]
      .replace(/\*\*/g, "")
      .replace(/\s+/g, " ")
      .trim()
    if (title.length < 4) continue

    steps.push(title.length > 120 ? `${title.slice(0, 117)}...` : title)
  }

  return steps.slice(0, 8)
}

function buildFallbackPlanWritePart(params: {
  prompt: string
  text: string
  plan?: any
}): any {
  const now = Date.now()
  const toolCallId = `codex-planwrite-fallback-${now}-${Math.random().toString(36).slice(2, 8)}`
  const requestSummary = params.prompt.trim().replace(/\s+/g, " ")
  const shortRequest =
    requestSummary.length > 140
      ? `${requestSummary.slice(0, 137)}...`
      : requestSummary
  const stepTitles = extractPlanStepTitles(params.text)
  const fallbackStepTitles =
    stepTitles.length > 0
      ? stepTitles
      : [
          "Confirm the existing project structure and constraints",
          shortRequest
            ? `Implement the requested change: ${shortRequest}`
            : "Implement the requested change",
          "Add the expected interaction, state handling, and edge-case behavior",
          "Verify the result through the relevant local run or manual check",
        ]

  const plan = normalizeCodexPlan(
    params.plan && typeof params.plan === "object"
      ? {
          ...params.plan,
          steps: Array.isArray(params.plan.steps)
            ? params.plan.steps
            : fallbackStepTitles.map((title) => ({ title, status: "pending" })),
        }
      : {
          id: `plan-${now}`,
          title: shortRequest ? `Plan: ${shortRequest}` : "Implementation plan",
          summary:
            params.text.trim() ||
            `Plan for: ${requestSummary || "the requested change"}`,
          status: "awaiting_approval",
          steps: fallbackStepTitles.map((title) => ({
            title,
            status: "pending",
          })),
        },
  )
  const output = {
    success: true,
    message: "Plan ready for review.",
    action: "create",
    plan,
    synthesized: true,
  }

  return {
    type: "tool-PlanWrite",
    toolCallId,
    toolName: "PlanWrite",
    state: "output-available",
    input: {
      action: "create",
      plan,
    },
    output,
    result: output,
    startedAt: now,
  }
}

function ensurePlanWriteForCodexPlanMode(params: {
  messages: any[]
  prompt: string
  fallbackPart: any | null
}): { messages: any[]; fallbackPart: any | null } {
  let lastAssistantIndex = -1
  for (let index = params.messages.length - 1; index >= 0; index--) {
    if (params.messages[index]?.role === "assistant") {
      lastAssistantIndex = index
      break
    }
  }
  if (lastAssistantIndex === -1) {
    return { messages: params.messages, fallbackPart: params.fallbackPart }
  }

  const lastAssistant = params.messages[lastAssistantIndex]
  if (hasUsableCodexPlanWritePart(lastAssistant)) {
    return { messages: params.messages, fallbackPart: null }
  }

  const planFromFailedPlanWrite = findPlanFromAnyPlanWritePart(lastAssistant)
  const fallbackPart =
    params.fallbackPart ||
    buildFallbackPlanWritePart({
      prompt: params.prompt,
      text: getAssistantText(lastAssistant),
      plan: planFromFailedPlanWrite,
    })
  const updatedAssistant = {
    ...lastAssistant,
    parts: [...(lastAssistant.parts || []), fallbackPart],
  }
  const messages = [...params.messages]
  messages[lastAssistantIndex] = updatedAssistant

  return { messages, fallbackPart }
}

type CodexPlanStreamAccumulator = {
  currentText: string
  parts: any[]
  toolPartsByCallId: Map<string, any>
}

function createCodexPlanStreamAccumulator(): CodexPlanStreamAccumulator {
  return {
    currentText: "",
    parts: [],
    toolPartsByCallId: new Map(),
  }
}

function flushCodexPlanText(accumulator: CodexPlanStreamAccumulator) {
  const text = accumulator.currentText.trim()
  if (text) {
    accumulator.parts.push({ type: "text", text })
  }
  accumulator.currentText = ""
}

function upsertCodexPlanToolPart(
  accumulator: CodexPlanStreamAccumulator,
  chunk: any,
): any | null {
  const toolCallId =
    typeof chunk?.toolCallId === "string" ? chunk.toolCallId : ""
  if (!toolCallId) return null

  let part = accumulator.toolPartsByCallId.get(toolCallId)
  if (!part) {
    const toolName =
      typeof chunk.toolName === "string" && chunk.toolName.length > 0
        ? chunk.toolName
        : "unknown"
    part = {
      type: `tool-${toolName}`,
      toolCallId,
      toolName,
      state: "input-streaming",
      startedAt: Date.now(),
    }
    accumulator.toolPartsByCallId.set(toolCallId, part)
    accumulator.parts.push(part)
  }

  if (typeof chunk.toolName === "string" && chunk.toolName.length > 0) {
    part.toolName = chunk.toolName
    part.type = `tool-${chunk.toolName}`
  }
  if (chunk.input !== undefined) {
    part.input = chunk.input
  }
  if (typeof chunk.title === "string" && chunk.title.length > 0) {
    part.title = chunk.title
  }

  return part
}

function accumulateCodexPlanStreamChunk(
  accumulator: CodexPlanStreamAccumulator,
  chunk: any,
) {
  if (!chunk || typeof chunk !== "object") return

  switch (chunk.type) {
    case "text-delta":
      accumulator.currentText += chunk.delta || ""
      break
    case "text-end":
      flushCodexPlanText(accumulator)
      break
    case "tool-input-start": {
      const part = upsertCodexPlanToolPart(accumulator, chunk)
      if (part) part.state = "input-streaming"
      break
    }
    case "tool-input-available": {
      const part = upsertCodexPlanToolPart(accumulator, chunk)
      if (part) part.state = "input-available"
      break
    }
    case "tool-input-error": {
      const part = upsertCodexPlanToolPart(accumulator, chunk)
      if (part) {
        part.state = "input-error"
        part.errorText = chunk.errorText
      }
      break
    }
    case "tool-output-available": {
      const part =
        typeof chunk.toolCallId === "string"
          ? accumulator.toolPartsByCallId.get(chunk.toolCallId)
          : null
      if (part) {
        part.state = "output-available"
        part.output = chunk.output
        part.result = chunk.output
      }
      break
    }
    case "tool-output-error": {
      const part =
        typeof chunk.toolCallId === "string"
          ? accumulator.toolPartsByCallId.get(chunk.toolCallId)
          : null
      if (part) {
        part.state = "output-error"
        part.errorText = chunk.errorText
      }
      break
    }
    case "tool-output-denied": {
      const part =
        typeof chunk.toolCallId === "string"
          ? accumulator.toolPartsByCallId.get(chunk.toolCallId)
          : null
      if (part) {
        part.state = "output-error"
        part.errorText = "Tool output denied"
      }
      break
    }
  }
}

function buildCodexPlanTools(params: {
  subChatId: string
  safeEmit: (chunk: any) => void
}) {
  return {
    AskUserQuestion: tool({
      description:
        "Ask the user concise follow-up questions before writing a plan. Use this only for high-impact ambiguity that cannot be resolved by inspecting the project. Provide answer options so the UI can collect the response.",
      inputSchema: z.object({
        questions: z.array(codexQuestionSchema).min(1).max(3),
      }),
      execute: async (input, options) => {
        const toolUseId = `${options.toolCallId || "AskUserQuestion"}-${crypto.randomUUID()}`
        const questions = normalizeCodexQuestions(input.questions)

        params.safeEmit({
          type: "ask-user-question",
          toolUseId,
          questions,
        })

        const response = await new Promise<{
          approved: boolean
          message?: string
          updatedInput?: unknown
        }>((resolve) => {
          const timeoutId = setTimeout(() => {
            pendingToolApprovals.delete(toolUseId)
            params.safeEmit({
              type: "ask-user-question-timeout",
              toolUseId,
            })
            resolve({
              approved: false,
              message: QUESTIONS_TIMED_OUT_MESSAGE,
            })
          }, ASK_USER_QUESTION_TIMEOUT_MS)

          pendingToolApprovals.set(toolUseId, {
            subChatId: params.subChatId,
            resolve: (decision) => {
              clearTimeout(timeoutId)
              resolve(decision)
            },
          })
        })

        if (!response.approved) {
          const result = response.message || QUESTIONS_SKIPPED_MESSAGE
          params.safeEmit({
            type: "ask-user-question-result",
            toolUseId,
            result,
          })
          return toMcpToolResult(result)
        }

        const answers =
          typeof response.updatedInput === "object" &&
          response.updatedInput !== null &&
          "answers" in response.updatedInput
            ? (response.updatedInput as { answers?: Record<string, string> })
                .answers || {}
            : {}
        const result = { answers }

        params.safeEmit({
          type: "ask-user-question-result",
          toolUseId,
          result,
        })

        return toMcpToolResult(result)
      },
    }),
    PlanWrite: tool({
      description:
        "Submit the final read-only implementation plan for user review. Call this exactly once when the plan is complete. Do not implement anything.",
      inputSchema: z.object({
        action: z.literal("create").optional(),
        plan: codexPlanSchema,
      }),
      execute: async (input) => {
        const plan = normalizeCodexPlan(input.plan)
        return toMcpToolResult({
          success: true,
          message: "Plan ready for review.",
          action: input.action || "create",
          plan,
        })
      },
    }),
  }
}

function getOrCreateProvider(params: {
  subChatId: string
  cwd: string
  mcpServers: CodexMcpServerForSession[]
  mcpFingerprint: string
  existingSessionId?: string
  authConfig?: {
    apiKey: string
  }
}): ACPProvider {
  const authFingerprint = getAuthFingerprint(params.authConfig)
  const existing = providerSessions.get(params.subChatId)

  if (
    existing &&
    existing.cwd === params.cwd &&
    existing.authFingerprint === authFingerprint &&
    existing.mcpFingerprint === params.mcpFingerprint
  ) {
    return existing.provider
  }

  if (existing) {
    existing.provider.cleanup()
    providerSessions.delete(params.subChatId)
  }

  const hasAppManagedApiKey = Boolean(params.authConfig?.apiKey?.trim())
  // When app-managed key auth is used, avoid resuming older persisted session IDs.
  // Those can be tied to unauthenticated/CLI-auth state and trigger auth loops.
  const existingSessionIdForProvider = hasAppManagedApiKey
    ? undefined
    : params.existingSessionId

  const provider = createACPProvider({
    command: resolveCodexAcpBinaryPath(),
    env: buildCodexProviderEnv(params.authConfig),
    authMethodId: getCodexAuthMethodId(params.authConfig),
    session: {
      cwd: params.cwd,
      mcpServers: params.mcpServers,
    },
    ...(existingSessionIdForProvider
      ? { existingSessionId: existingSessionIdForProvider }
      : {}),
    persistSession: true,
  })

  providerSessions.set(params.subChatId, {
    provider,
    cwd: params.cwd,
    authFingerprint,
    mcpFingerprint: params.mcpFingerprint,
  })

  return provider
}

function cleanupProvider(subChatId: string): void {
  const existing = providerSessions.get(subChatId)
  if (!existing) return

  existing.provider.cleanup()
  providerSessions.delete(subChatId)
}

export const codexRouter = router({
  getIntegration: publicProcedure.query(async () => {
    const result = await runCodexCli(["login", "status"])
    const combinedOutput = [result.stdout, result.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n")
      .trim()

    const state = normalizeCodexIntegrationState(combinedOutput)

    return {
      state,
      isConnected:
        state === "connected_chatgpt" || state === "connected_api_key",
      rawOutput: combinedOutput,
      exitCode: result.exitCode,
    }
  }),

  logout: publicProcedure.mutation(async () => {
    const logoutResult = await runCodexCli(["logout"])
    const statusResult = await runCodexCli(["login", "status"])

    const statusOutput = [statusResult.stdout, statusResult.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n")
      .trim()

    const state = normalizeCodexIntegrationState(statusOutput)
    const isConnected =
      state === "connected_chatgpt" || state === "connected_api_key"

    if (isConnected) {
      throw new Error("Failed to log out from Codex. Please try again.")
    }

    const logoutOutput = [logoutResult.stdout, logoutResult.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n")
      .trim()

    return {
      success: true,
      state,
      isConnected: false,
      logoutExitCode: logoutResult.exitCode,
      logoutOutput,
      statusOutput,
    }
  }),

  startLogin: publicProcedure.mutation(() => {
    const existingSession = getActiveLoginSession()
    if (existingSession) {
      return toLoginSessionResponse(existingSession)
    }

    const codexCliPath = resolveBundledCodexCliPath()
    const sessionId = crypto.randomUUID()

    const child = spawn(codexCliPath, ["login"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      windowsHide: true,
    })

    const session: CodexLoginSession = {
      id: sessionId,
      process: child,
      state: "running",
      output: "",
      url: null,
      error: null,
      exitCode: null,
    }

    const handleChunk = (chunk: Buffer | string) => {
      appendLoginOutput(session, chunk.toString("utf8"))
    }

    child.stdout.on("data", handleChunk)
    child.stderr.on("data", handleChunk)

    child.once("error", (error) => {
      session.state = "error"
      session.error = `[codex] Failed to start login flow: ${error.message}`
      session.process = null
    })

    child.once("close", (exitCode) => {
      session.exitCode = exitCode
      session.process = null

      if (session.state === "cancelled") {
        return
      }

      if (exitCode === 0) {
        session.state = "success"
        session.error = null
      } else {
        session.state = "error"
        session.error = session.error || `Codex login exited with code ${exitCode ?? "unknown"}`
      }
    })

    loginSessions.set(sessionId, session)

    return toLoginSessionResponse(session)
  }),

  getLoginSession: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
      }),
    )
    .query(({ input }) => {
      const session = loginSessions.get(input.sessionId)
      if (!session) {
        throw new Error("Codex login session not found")
      }

      return toLoginSessionResponse(session)
    }),

  cancelLogin: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const session = loginSessions.get(input.sessionId)
      if (!session) {
        return { success: true, found: false }
      }

      session.state = "cancelled"
      session.error = null

      if (session.process && !session.process.killed) {
        session.process.kill("SIGTERM")
      }

      return { success: true, found: true, session: toLoginSessionResponse(session) }
    }),

  getAllMcpConfig: publicProcedure.query(async () => {
    try {
      return await getAllCodexMcpConfigHandler()
    } catch (error) {
      console.error("[codex.getAllMcpConfig] Error:", error)
      return {
        groups: [],
        error: extractCodexError(error).message,
      }
    }
  }),

  refreshMcpConfig: publicProcedure.mutation(() => {
    clearCodexMcpCache()
    return { success: true }
  }),

  addMcpServer: publicProcedure
    .input(
      z.object({
        name: z
          .string()
          .min(1)
          .regex(
            /^[a-zA-Z0-9_-]+$/,
            "Name must contain only letters, numbers, underscores, and hyphens",
          ),
        scope: z.enum(["global", "project"]),
        transport: z.enum(["stdio", "http"]),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        url: z.string().url().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.scope !== "global") {
        throw new Error("Codex MCP currently supports global scope only.")
      }

      const args = ["mcp", "add", input.name.trim()]
      if (input.transport === "http") {
        const url = input.url?.trim()
        if (!url) {
          throw new Error("URL is required for HTTP servers.")
        }
        args.push("--url", url)
      } else {
        const command = input.command?.trim()
        if (!command) {
          throw new Error("Command is required for stdio servers.")
        }

        args.push("--", command, ...(input.args || []))
      }

      await runCodexCliChecked(args)
      clearCodexMcpCache()
      return { success: true }
    }),

  removeMcpServer: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        scope: z.enum(["global", "project"]).default("global"),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.scope !== "global") {
        throw new Error("Codex MCP currently supports global scope only.")
      }

      await runCodexCliChecked(["mcp", "remove", input.name.trim()])
      clearCodexMcpCache()
      return { success: true }
    }),

  startMcpOAuth: publicProcedure
    .input(
      z.object({
        serverName: z.string().min(1),
        projectPath: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const projectPath = input.projectPath?.trim()
        await runCodexCliChecked(["mcp", "login", input.serverName.trim()], {
          cwd: projectPath && projectPath.length > 0 ? projectPath : undefined,
        })
        clearCodexMcpCache()
        return { success: true as const }
      } catch (error) {
        return {
          success: false as const,
          error: extractCodexError(error).message,
        }
      }
    }),

  logoutMcpServer: publicProcedure
    .input(
      z.object({
        serverName: z.string().min(1),
        projectPath: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const projectPath = input.projectPath?.trim()
        await runCodexCliChecked(["mcp", "logout", input.serverName.trim()], {
          cwd: projectPath && projectPath.length > 0 ? projectPath : undefined,
        })
        clearCodexMcpCache()
        return { success: true as const }
      } catch (error) {
        return {
          success: false as const,
          error: extractCodexError(error).message,
        }
      }
    }),

  chat: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        chatId: z.string(),
        runId: z.string(),
        prompt: z.string(),
        model: z.string().optional(),
        cwd: z.string(),
        projectPath: z.string().optional(),
        mode: z.enum(["plan", "agent"]).default("agent"),
        sessionId: z.string().optional(),
        forceNewSession: z.boolean().optional(),
        images: z.array(imageAttachmentSchema).optional(),
        authConfig: z
          .object({
            apiKey: z.string().min(1),
          })
          .optional(),
      }),
    )
    .subscription(({ input }) => {
      return observable<any>((emit) => {
        const existingStream = activeStreams.get(input.subChatId)
        if (existingStream) {
          existingStream.cancelRequested = true
          existingStream.controller.abort()
          clearPendingApprovals("Session ended.", input.subChatId)
          // Ensure old run cannot continue emitting after supersede.
          cleanupProvider(input.subChatId)
        }

        const abortController = new AbortController()
        activeStreams.set(input.subChatId, {
          runId: input.runId,
          controller: abortController,
          cancelRequested: false,
        })

        let isActive = true

        const safeEmit = (chunk: any) => {
          if (!isActive) return
          try {
            emit.next(chunk)
          } catch {
            isActive = false
          }
        }

        const safeComplete = () => {
          if (!isActive) return
          isActive = false
          try {
            emit.complete()
          } catch {
            // Ignore double completion
          }
        }

        ;(async () => {
          try {
            const db = getDatabase()

            const existingSubChat = db
              .select()
              .from(subChats)
              .where(eq(subChats.id, input.subChatId))
              .get()

            if (!existingSubChat) {
              throw new Error("Sub-chat not found")
            }

            const existingMessages = parseStoredMessages(existingSubChat.messages)
            const requestedModelId =
              extractCodexModelId(input.model) || DEFAULT_CODEX_MODEL
            const selectedModelId = preprocessCodexModelName({
              modelId: requestedModelId,
              authConfig: input.authConfig,
            })
            const metadataModel = selectedModelId

            const lastMessage = existingMessages[existingMessages.length - 1]
            const isDuplicatePrompt =
              lastMessage?.role === "user" &&
              extractPromptFromStoredMessage(lastMessage) === input.prompt

            let messagesForStream = existingMessages
            const isAuthoritativeRun = () => {
              const currentStream = activeStreams.get(input.subChatId)
              return !currentStream || currentStream.runId === input.runId
            }

            const persistSubChatMessages = (messages: any[]) => {
              if (!isAuthoritativeRun()) {
                return false
              }

              const json = JSON.stringify(messages)
              db.update(subChats)
                .set({
                  messages: json,
                  ...computeFileStatsFromMessages(json),
                  updatedAt: new Date(),
                })
                .where(eq(subChats.id, input.subChatId))
                .run()
              return true
            }

            const cleanAssistantMessageForPersistence = (message: any) => {
              if (!message || message.role !== "assistant") return message
              if (!Array.isArray(message.parts)) return message

              const cleanedParts = message.parts.filter(
                (part: any) => part?.state !== "input-streaming",
              )

              if (cleanedParts.length === 0) {
                return null
              }

              const cleanedMessage = {
                ...message,
                parts: cleanedParts,
              }

              return normalizeCodexAssistantMessage(cleanedMessage, {
                normalizeState: true,
              })
            }

            if (!isDuplicatePrompt) {
              const userMessage = {
                id: crypto.randomUUID(),
                role: "user",
                parts: buildUserParts(input.prompt, input.images),
                metadata: { model: metadataModel },
              }

              messagesForStream = [...existingMessages, userMessage]

              {
                const messagesForStreamJson = JSON.stringify(messagesForStream)
                db.update(subChats)
                  .set({
                    messages: messagesForStreamJson,
                    ...computeFileStatsFromMessages(messagesForStreamJson),
                    updatedAt: new Date(),
                  })
                  .where(eq(subChats.id, input.subChatId))
                  .run()
              }
            }

            if (input.forceNewSession) {
              cleanupProvider(input.subChatId)
            }

            let mcpSnapshot: CodexMcpSnapshot = {
              mcpServersForSession: [],
              groups: [],
              fingerprint: getCodexMcpFingerprint([]),
              fetchedAt: Date.now(),
              toolsResolved: false,
            }
            try {
              const resolvedProjectPathFromCwd = resolveProjectPathFromWorktree(
                input.cwd,
              )
              const mcpLookupPath =
                input.projectPath || resolvedProjectPathFromCwd || input.cwd
              mcpSnapshot = await resolveCodexMcpSnapshot({
                lookupPath: mcpLookupPath,
              })
            } catch (mcpError) {
              console.error("[codex] Failed to resolve MCP servers:", mcpError)
            }

            const provider = getOrCreateProvider({
              subChatId: input.subChatId,
              cwd: input.cwd,
              mcpServers: mcpSnapshot.mcpServersForSession,
              mcpFingerprint: mcpSnapshot.fingerprint,
              existingSessionId:
                input.forceNewSession
                  ? undefined
                  : getLastSessionId(existingMessages),
              authConfig: input.authConfig,
            })

            const startedAt = Date.now()
            let latestSessionId =
              provider.getSessionId() ||
              input.sessionId ||
              getLastSessionId(existingMessages)
            let usagePromise: Promise<CodexUsageMetadata | null> | null = null

            const resolveUsageOnce = (): Promise<CodexUsageMetadata | null> => {
              if (usagePromise) return usagePromise

              const sessionId = latestSessionId || provider.getSessionId()
              if (!sessionId) {
                return Promise.resolve(null)
              }

              usagePromise = pollUsage(sessionId, {
                notBeforeTimestampMs: startedAt,
                modelId: selectedModelId,
              }).catch(() => null)
              return usagePromise
            }

            const catchup = computeCatchupBlock(messagesForStream, "codex")
            const planInstruction =
              input.mode === "plan"
                ? [
                    "[PLAN MODE] You are in plan mode. Do not modify, create, or delete any files; do not run commands that change state.",
                    "Read the codebase as needed using read-only tools.",
                    "If any high-impact requirement is ambiguous and cannot be resolved from the repository, call AskUserQuestion with concise multiple-choice follow-up questions before planning.",
                    "A plan-mode turn is incomplete until PlanWrite succeeds. Do not stop after inspection or status text.",
                    "When no clarification is needed, immediately call PlanWrite in this same turn.",
                    "Call PlanWrite exactly once with action \"create\" and plan.status \"awaiting_approval\".",
                    "PlanWrite input must include a concrete task-specific plan with title, summary, and pending steps. Include step descriptions and files when useful.",
                    "Do not write the final plan as plain text only, do not call PlanWrite more than once, and do not restate the plan after PlanWrite.",
                    "After PlanWrite, stop and wait for the user's approval before implementing anything.",
                  ].join("\n")
                : ""
            const augmentedPrompt = [planInstruction, catchup, input.prompt]
              .filter((segment): segment is string => Boolean(segment))
              .join("\n\n")

            const codexModeId = input.mode === "plan" ? "read-only" : "full-access"
            const planTools =
              input.mode === "plan"
                ? buildCodexPlanTools({
                    subChatId: input.subChatId,
                    safeEmit,
                  })
                : {}
            const tools =
              input.mode === "plan" ? acpTools(planTools) : provider.tools

            const result = streamText({
              model: provider.languageModel(selectedModelId, codexModeId),
              messages: [
                {
                  role: "user",
                  content: buildModelMessageContent(augmentedPrompt, input.images),
                },
              ],
              tools,
              ...(input.mode === "plan"
                ? { stopWhen: stepCountIs(8) }
                : {}),
              abortSignal: abortController.signal,
            })

            let planWriteFallbackPart: any | null = null
            let planWriteFallbackEmitted = false
            let sawStreamError = false
            const planStreamAccumulator =
              input.mode === "plan"
                ? createCodexPlanStreamAccumulator()
                : null

            const emitPlanWriteFallbackIfNeeded = () => {
              if (
                input.mode !== "plan" ||
                !planStreamAccumulator ||
                planWriteFallbackEmitted ||
                sawStreamError
              ) {
                return
              }

              flushCodexPlanText(planStreamAccumulator)
              const messagesWithPlanFallback = ensurePlanWriteForCodexPlanMode({
                messages: [
                  {
                    id: "codex-plan-stream-accumulator",
                    role: "assistant",
                    parts: planStreamAccumulator.parts,
                  },
                ],
                prompt: input.prompt,
                fallbackPart: planWriteFallbackPart,
              })

              planWriteFallbackPart = messagesWithPlanFallback.fallbackPart
              if (!planWriteFallbackPart) return

              planWriteFallbackEmitted = true
              safeEmit({
                type: "tool-input-start",
                toolCallId: planWriteFallbackPart.toolCallId,
                toolName: "PlanWrite",
                providerMetadata: {
                  custom: {
                    startedAt: planWriteFallbackPart.startedAt,
                    synthesized: true,
                  },
                },
              })
              safeEmit({
                type: "tool-input-available",
                toolCallId: planWriteFallbackPart.toolCallId,
                toolName: "PlanWrite",
                input: planWriteFallbackPart.input,
                providerMetadata: {
                  custom: {
                    startedAt: planWriteFallbackPart.startedAt,
                    synthesized: true,
                  },
                },
              })
              safeEmit({
                type: "tool-output-available",
                toolCallId: planWriteFallbackPart.toolCallId,
                output: planWriteFallbackPart.output,
              })
            }

            const uiStream = result.toUIMessageStream({
              originalMessages: messagesForStream,
              generateMessageId: () => crypto.randomUUID(),
              messageMetadata: ({ part }) => {
                const sessionId = provider.getSessionId() || undefined
                if (sessionId) {
                  latestSessionId = sessionId
                }

                if (part.type === "finish") {
                  return {
                    model: metadataModel,
                    sessionId,
                    durationMs: Date.now() - startedAt,
                    resultSubtype: part.finishReason === "error" ? "error" : "success",
                    stopReason: part.finishReason ?? undefined,
                  }
                }

                if (sessionId) {
                  return {
                    model: metadataModel,
                    sessionId,
                  }
                }

                return { model: metadataModel }
              },
              onFinish: async ({ messages }) => {
                try {
                  const usageMetadata = await resolveUsageOnce()
                  const messagesWithPlanFallback =
                    input.mode === "plan"
                      ? ensurePlanWriteForCodexPlanMode({
                          messages,
                          prompt: input.prompt,
                          fallbackPart: planWriteFallbackPart,
                        })
                      : { messages, fallbackPart: null }

                  planWriteFallbackPart = messagesWithPlanFallback.fallbackPart

                  const assistantIndexes = messagesWithPlanFallback.messages
                    .map((message: any, index: number) =>
                      message?.role === "assistant" ? index : -1,
                    )
                    .filter((index: number) => index !== -1)
                  const lastAssistantIndex =
                    assistantIndexes[assistantIndexes.length - 1]

                  const cleanedMessages = messagesWithPlanFallback.messages
                    .map((message: any, index: number) => {
                      const shouldAddUsage =
                        usageMetadata &&
                        message?.role === "assistant" &&
                        index === lastAssistantIndex
                      const messageWithUsage = shouldAddUsage
                        ? {
                            ...message,
                            metadata: {
                              ...(message.metadata || {}),
                              ...usageMetadata,
                            },
                          }
                        : message

                      return cleanAssistantMessageForPersistence(messageWithUsage)
                    })
                    .filter(Boolean)

                  if (cleanedMessages.length === 0) {
                    persistSubChatMessages(messagesForStream)
                    return
                  }

                  persistSubChatMessages(cleanedMessages)
                } catch (error) {
                  console.error("[codex] Failed to persist messages:", error)
                }
              },
              onError: (error) => extractCodexError(error).message,
            })

            const reader = uiStream.getReader()
            let pendingFinishChunk: any | null = null
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              if (value?.type === "error") {
                sawStreamError = true
                const normalized = extractCodexError(value)

                if (isCodexAuthError(normalized)) {
                  safeEmit({ ...value, type: "auth-error", errorText: normalized.message })
                } else {
                  safeEmit({ ...value, errorText: normalized.message })
                }
                continue
              }

              if (value?.type === "abort") {
                sawStreamError = true
              }

              if (planStreamAccumulator) {
                accumulateCodexPlanStreamChunk(planStreamAccumulator, value)
              }

              if (value?.type === "finish") {
                emitPlanWriteFallbackIfNeeded()
                pendingFinishChunk = value
                continue
              }

              safeEmit(value)
            }

            if (input.mode === "plan") {
              emitPlanWriteFallbackIfNeeded()
            }

            if (pendingFinishChunk) {
              const usageMetadata = await resolveUsageOnce()
              if (usageMetadata) {
                safeEmit({
                  type: "message-metadata",
                  messageMetadata: usageMetadata,
                })
              }
              safeEmit(pendingFinishChunk)
            } else {
              safeEmit({ type: "finish" })
            }

            safeComplete()
          } catch (error) {
            const normalized = extractCodexError(error)

            console.error("[codex] chat stream error:", error)
            if (isCodexAuthError(normalized)) {
              safeEmit({ type: "auth-error", errorText: normalized.message })
            } else {
              safeEmit({ type: "error", errorText: normalized.message })
            }
            safeEmit({ type: "finish" })
            safeComplete()
          } finally {
            const activeStream = activeStreams.get(input.subChatId)
            if (activeStream?.runId === input.runId) {
              const shouldCleanupProvider =
                abortController.signal.aborted || activeStream.cancelRequested
              if (shouldCleanupProvider) {
                cleanupProvider(input.subChatId)
              }
              activeStreams.delete(input.subChatId)
            }
          }
        })()

        return () => {
          isActive = false
          abortController.abort()
          clearPendingApprovals("Session ended.", input.subChatId)

          const activeStream = activeStreams.get(input.subChatId)
          if (activeStream?.runId === input.runId) {
            activeStream.cancelRequested = true
          }
        }
      })
    }),

  cancel: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        runId: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const activeStream = activeStreams.get(input.subChatId)
      if (!activeStream) {
        return { cancelled: false, ignoredStale: false }
      }

      if (activeStream.runId !== input.runId) {
        return { cancelled: false, ignoredStale: true }
      }

      activeStream.cancelRequested = true
      activeStream.controller.abort()
      clearPendingApprovals("Session cancelled.", input.subChatId)

      return { cancelled: true, ignoredStale: false }
    }),

  cleanup: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .mutation(({ input }) => {
      cleanupProvider(input.subChatId)

      const activeStream = activeStreams.get(input.subChatId)
      if (activeStream) {
        activeStream.controller.abort()
        activeStreams.delete(input.subChatId)
      }
      clearPendingApprovals("Session ended.", input.subChatId)

      return { success: true }
    }),
})
