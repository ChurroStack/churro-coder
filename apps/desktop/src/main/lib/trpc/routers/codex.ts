import { observable } from '@trpc/server/observable';
import { eq } from 'drizzle-orm';
import { app } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { normalizeCodexAssistantMessage } from '../../../../shared/codex-tool-normalizer';
import type { ServerRequest } from '../../../../shared/codex-app-server-schema';
import type { ThreadUnsubscribeParams } from '../../../../shared/codex-app-server-schema/v2';
import { computeCatchupBlock } from '../../multi-provider/catchup';
import { getProviderForModelId } from '../../../../shared/provider-from-model';
import {
  CodexAppServerClient,
  CodexAppServerClosedError,
  type CodexAppServerNotification,
  type CodexAppServerServerRequest
} from '../../codex/app-server-client';
import {
  CODEX_FORCE_RESTART_AFTER,
  CODEX_MAX_ATTEMPTS,
  classifyCodexFailure,
  delayWithAbort,
  getCodexRetryDelay,
  type CodexFailureClassification
} from '../../codex/recovery';
import { waitForAppServerTurn } from '../../codex/wait-for-app-server-turn';
import { mapAppServerUsageToMetadata, type CodexUsageMetadata } from '../../codex/usage-metadata';
import { cleanupCodexThreadSubscription, trackCodexThreadSubscription } from '../../codex/thread-subscriptions';
import { getClaudeShellEnvironment } from '../../claude/env';
import { resolveProjectPathFromWorktree } from '../../claude-config';
import { getDatabase, projects as projectsTable, subChats } from '../../db';
import { computeFileStatsFromMessages } from '../../file-stats';
import { fetchMcpTools, fetchMcpToolsStdio, type McpToolInfo } from '../../mcp-auth';
import { publicProcedure, router } from '../index';
import { clearPendingApprovals, pendingToolApprovals } from './tool-approvals';
import { resolveSandboxPolicy } from '../../sandbox/policy';
import { writeCurrentPlan, hasPlan } from '../../plans/plan-store';
import { formatStructuredPlanAsMarkdown } from '../../../../shared/plans/format-codex-plan';
import { getMcpHttpEndpoint, initMcpHttpServer } from '../../mcp/http-transport';
import { recordChatEvent } from '../../chat-event-buffer';
import { persistSubChatRunMode } from '../../sub-chat-mode';
import {
  buildApprovedPlanReadPlanUnavailableMessage,
  getAppOwnedChurroCoderMcpServerName,
  getAppOwnedChurroCoderReadPlanToolName,
  resolveAppOwnedMcpHeaders,
  shouldRemoveStaleAppOwnedMcpEntry
} from '../codex-mcp-auth';
import { getCodexAppServerApprovalResponse } from '../codex-app-server-approval-policy';
import { decideCodexMcpElicitation } from '../codex-mcp-elicitation';
import { buildCodexApprovedPlanHint, buildCodexModeInstruction } from '../codex-mode-prompts';
import { sanitizeCodexPlanSummary } from '../codex-plan-write';
import { buildCodexSandboxPolicy, type CodexSandboxPolicy } from '../codex-sandbox-policy';
import { createTaskListPartFromPlan } from '../codex-plan-task-part';

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional()
});

const ASK_USER_QUESTION_TIMEOUT_MS = 60_000;
const QUESTIONS_SKIPPED_MESSAGE = 'User skipped questions - proceed with defaults';
const QUESTIONS_TIMED_OUT_MESSAGE = 'Timed out';

const codexQuestionSchema = z.object({
  question: z.string().min(1),
  header: z.string().min(1),
  options: z
    .array(
      z.object({
        label: z.string().min(1),
        description: z.string().optional()
      })
    )
    .min(2),
  multiSelect: z.boolean().optional()
});

const codexPlanStepSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  files: z.array(z.string()).optional(),
  estimatedComplexity: z.enum(['low', 'medium', 'high']).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'skipped']).optional()
});

const codexPlanSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  summary: z.string().optional(),
  steps: z.array(codexPlanStepSchema),
  status: z.literal('awaiting_approval').optional()
});

type CodexAppServerSession = {
  client: CodexAppServerClient;
  authFingerprint: string | null;
  mcpBearer: string | null;
  lastActivityAt: number;
};

type CodexLoginSessionState = 'running' | 'success' | 'error' | 'cancelled';

type CodexLoginSession = {
  id: string;
  process: ChildProcess | null;
  state: CodexLoginSessionState;
  output: string;
  url: string | null;
  error: string | null;
  exitCode: number | null;
};

type CodexIntegrationState = 'connected_chatgpt' | 'connected_api_key' | 'not_logged_in' | 'unknown';

type CodexMcpServerForSession =
  | {
      name: string;
      type: 'stdio';
      command: string;
      args: string[];
      env: Array<{ name: string; value: string }>;
    }
  | {
      name: string;
      type: 'http';
      url: string;
      headers: Array<{ name: string; value: string }>;
    };

type CodexMcpServerForSettings = {
  name: string;
  status: 'connected' | 'failed' | 'pending' | 'needs-auth';
  tools: McpToolInfo[];
  needsAuth: boolean;
  config: Record<string, unknown>;
};

type CodexMcpSnapshot = {
  mcpServersForSession: CodexMcpServerForSession[];
  groups: Array<{
    groupName: string;
    projectPath: string | null;
    mcpServers: CodexMcpServerForSettings[];
  }>;
  fingerprint: string;
  fetchedAt: number;
  toolsResolved: boolean;
};

type ActiveCodexStream = {
  runId: string;
  controller: AbortController;
  cancelRequested: boolean;
  client?: CodexAppServerClient;
  sandboxPolicy?: CodexSandboxPolicy;
  threadId?: string;
  turnId?: string;
};

const appServerSessions = new Map<string, CodexAppServerSession>();
const subChatThreadIds = new Map<string, string>();
const subChatSessionKeys = new Map<string, string>();
const activeStreamsByThreadId = new Map<string, string>();
const activeThreadIdsByTurnId = new Map<string, string>();
const activeStreams = new Map<string, ActiveCodexStream>();

type AppServerTurnAccumulator = {
  subChatId: string;
  prompt: string;
  model: string;
  mode: 'plan' | 'execute' | 'explore';
  startedAt: number;
  safeEmit: (chunk: any) => void;
  parts: any[];
  currentTextId: string | null;
  currentText: string;
  toolPartsByItemId: Map<string, any>;
  usageMetadata: CodexUsageMetadata | null;
  completed: boolean;
  lastEventAt: number;
  stopReason?: string;
  resultSubtype?: string;
};

const activeAppServerTurns = new Map<string, AppServerTurnAccumulator>();

/** Check if there are any active Codex streaming sessions */
export function hasActiveCodexStreams(): boolean {
  return activeStreams.size > 0;
}

/** Abort all active Codex streams so their cleanup saves partial state */
export function abortAllCodexStreams(): void {
  for (const [subChatId, stream] of activeStreams) {
    console.log(`[codex] Aborting stream ${subChatId} before reload`);
    stream.controller.abort();
    void interruptCodexTurn(stream);
    clearPendingApprovals('Session ended.', subChatId);
    if (stream.turnId) {
      activeThreadIdsByTurnId.delete(stream.turnId);
    }
    if (stream.threadId) {
      activeStreamsByThreadId.delete(stream.threadId);
      activeAppServerTurns.delete(stream.threadId);
    }
  }
  activeStreams.clear();
}
const loginSessions = new Map<string, CodexLoginSession>();
const codexMcpCache = new Map<string, CodexMcpSnapshot>();

const URL_CANDIDATE_REGEX = /https?:\/\/[^\s]+/g;
const ANSI_ESCAPE_REGEX = /\u001B\[[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC_REGEX = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g;

const AUTH_HINTS = [
  'not logged in',
  'authentication required',
  'auth required',
  'login required',
  'missing credentials',
  'no credentials',
  'unauthorized',
  'forbidden',
  'codex login',
  '401',
  '403'
];
const DEFAULT_CODEX_MODEL = 'gpt-5.4/high';
const CODEX_MCP_TOOLS_FETCH_TIMEOUT_MS = 40_000;

type CodexChangedFileMetadata = {
  filePath: string;
  additions: number;
  deletions: number;
  status: string;
};

type GitChangeSnapshotEntry = CodexChangedFileMetadata & {
  fingerprint: string;
};

type GitChangeSnapshot = Map<string, GitChangeSnapshotEntry>;

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
        env_http_headers: z.record(z.string()).nullable().optional()
      })
      .passthrough(),
    auth_status: z.string().nullable().optional()
  })
  .passthrough();

type CodexMcpListEntry = z.infer<typeof codexMcpListEntrySchema>;

function resolveBundledCodexCliPath(): string {
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const resourcesDir = app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : join(app.getAppPath(), 'resources', 'bin', `${process.platform}-${process.arch}`);

  const binaryPath = join(resourcesDir, binaryName);
  if (existsSync(binaryPath)) {
    return binaryPath;
  }

  const hint = app.isPackaged
    ? 'Binary is missing from bundled resources.'
    : 'Run `bun run codex:download` to download it for local dev.';

  throw new Error(`[codex] Bundled Codex CLI not found at ${binaryPath}. ${hint}`);
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_OSC_REGEX, '').replace(ANSI_ESCAPE_REGEX, '');
}

function isLocalhostHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized.endsWith('.localhost')
  );
}

function extractFirstNonLocalhostUrl(output: string): string | null {
  const matches = stripAnsi(output).match(URL_CANDIDATE_REGEX);
  if (!matches) return null;

  for (const match of matches) {
    try {
      const parsedUrl = new URL(match.trim().replace(/[),.;!?]+$/, ''));
      if (!isLocalhostHostname(parsedUrl.hostname)) {
        return parsedUrl.toString();
      }
    } catch {
      // Ignore invalid URL candidates.
    }
  }

  return null;
}

function appendLoginOutput(session: CodexLoginSession, chunk: string): void {
  const cleanChunk = stripAnsi(chunk);
  if (!cleanChunk) return;

  session.output += cleanChunk;

  if (!session.url) {
    session.url = extractFirstNonLocalhostUrl(session.output);
  }
}

function toLoginSessionResponse(session: CodexLoginSession) {
  return {
    sessionId: session.id,
    state: session.state,
    url: session.url,
    output: session.output,
    error: session.error,
    exitCode: session.exitCode
  };
}

function getActiveLoginSession(): CodexLoginSession | null {
  for (const session of loginSessions.values()) {
    if (session.state === 'running' && session.process && !session.process.killed) {
      return session;
    }
  }

  return null;
}

function extractCodexError(error: unknown): { message: string; code?: string } {
  const anyError = error as any;
  const message =
    anyError?.data?.message || anyError?.errorText || anyError?.message || anyError?.error || String(error);
  const code = anyError?.data?.code || anyError?.code;

  return {
    message: typeof message === 'string' ? message : String(message),
    code: typeof code === 'string' ? code : undefined
  };
}

function isCodexAuthError(params: { message?: string | null; code?: string | null }): boolean {
  const searchableText = `${params.code || ''} ${params.message || ''}`.toLowerCase();
  return AUTH_HINTS.some((hint) => searchableText.includes(hint));
}

type RunCodexCliOptions = {
  cwd?: string;
};

async function runCodexCli(
  args: string[],
  options?: RunCodexCliOptions
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
}> {
  const codexCliPath = resolveBundledCodexCliPath();
  const cwd = options?.cwd?.trim();

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(codexCliPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: cwd && cwd.length > 0 ? cwd : undefined,
      env: process.env,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.once('error', (error) => {
      rejectPromise(new Error(`[codex] Failed to execute \`codex ${args.join(' ')}\`: ${error.message}`));
    });

    child.once('close', (exitCode) => {
      resolvePromise({
        stdout: stripAnsi(stdout),
        stderr: stripAnsi(stderr),
        exitCode
      });
    });
  });
}

async function runCodexCliChecked(
  args: string[],
  options?: RunCodexCliOptions
): Promise<{
  stdout: string;
  stderr: string;
}> {
  const result = await runCodexCli(args, options);
  if (result.exitCode === 0) {
    return {
      stdout: result.stdout,
      stderr: result.stderr
    };
  }

  const message =
    result.stderr.trim() ||
    result.stdout.trim() ||
    `Codex command failed with exit code ${result.exitCode ?? 'unknown'}`;
  throw new Error(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function runGit(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return await new Promise((resolvePromise) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      resolvePromise({ stdout: '', stderr: error.message, exitCode: 1 });
    });
    child.once('close', (exitCode) => {
      resolvePromise({ stdout, stderr, exitCode });
    });
  });
}

function normalizeGitPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  const renameArrowIndex = trimmed.lastIndexOf(' -> ');
  if (renameArrowIndex >= 0) {
    return trimmed.slice(renameArrowIndex + ' -> '.length).trim();
  }
  return trimmed.replace(/^"|"$/g, '');
}

function countLines(content: string): number {
  if (!content) return 0;
  return content.split('\n').length;
}

async function countFileLines(cwd: string, relativePath: string): Promise<number> {
  try {
    const content = await readFile(join(cwd, relativePath), 'utf8');
    return countLines(content);
  } catch {
    return 0;
  }
}

async function captureGitChangeSnapshot(cwd: string): Promise<GitChangeSnapshot> {
  const snapshot: GitChangeSnapshot = new Map();
  const [numstatResult, statusResult] = await Promise.all([
    runGit(cwd, ['diff', '--numstat', 'HEAD', '--']),
    runGit(cwd, ['status', '--porcelain'])
  ]);

  if (numstatResult.exitCode === 0) {
    for (const line of numstatResult.stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [rawAdditions, rawDeletions, ...pathParts] = line.split('\t');
      const relativePath = normalizeGitPath(pathParts.join('\t'));
      if (!relativePath) continue;
      const additions = Number.parseInt(rawAdditions || '0', 10);
      const deletions = Number.parseInt(rawDeletions || '0', 10);
      snapshot.set(relativePath, {
        filePath: join(cwd, relativePath),
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
        status: 'modified',
        fingerprint: line
      });
    }
  }

  if (statusResult.exitCode === 0) {
    for (const line of statusResult.stdout.split(/\r?\n/)) {
      if (line.length < 4) continue;
      const status = line.slice(0, 2);
      const relativePath = normalizeGitPath(line.slice(3));
      if (!relativePath) continue;
      const existing = snapshot.get(relativePath);
      if (existing) {
        existing.status = status.trim() || existing.status;
        existing.fingerprint = `${existing.fingerprint}|${status}`;
        continue;
      }

      const additions = status === '??' ? await countFileLines(cwd, relativePath) : 0;
      snapshot.set(relativePath, {
        filePath: join(cwd, relativePath),
        additions,
        deletions: 0,
        status: status.trim() || 'changed',
        fingerprint: `${status}\t${relativePath}`
      });
    }
  }

  return snapshot;
}

function diffGitChangeSnapshots(before: GitChangeSnapshot, after: GitChangeSnapshot): CodexChangedFileMetadata[] {
  const changed: CodexChangedFileMetadata[] = [];
  for (const [relativePath, afterEntry] of after) {
    const beforeEntry = before.get(relativePath);
    if (beforeEntry?.fingerprint === afterEntry.fingerprint) continue;
    changed.push({
      filePath: afterEntry.filePath,
      additions: afterEntry.additions,
      deletions: afterEntry.deletions,
      status: afterEntry.status
    });
  }
  return changed;
}

function getCodexMcpAuthState(authStatus: string | null | undefined): {
  supportsAuth: boolean;
  authenticated: boolean;
  needsAuth: boolean;
} {
  const normalized = (authStatus || '').trim().toLowerCase();

  // Exact CLI values from codex-rs/protocol/src/protocol.rs (McpAuthStatus):
  // unsupported | not_logged_in | bearer_token | o_auth
  switch (normalized) {
    case '':
    case 'none':
    case 'unsupported':
      return { supportsAuth: false, authenticated: false, needsAuth: false };
    case 'not_logged_in':
      return { supportsAuth: true, authenticated: false, needsAuth: true };
    case 'bearer_token':
    case 'o_auth':
      return { supportsAuth: true, authenticated: true, needsAuth: false };
    default:
      // Unknown/forward-compatible value: don't force needs-auth.
      return { supportsAuth: true, authenticated: false, needsAuth: false };
  }
}

function objectToPairs(
  value: Record<string, string> | null | undefined
): Array<{ name: string; value: string }> | undefined {
  if (!value) return undefined;
  const pairs = Object.entries(value)
    .filter(([name, val]) => typeof name === 'string' && typeof val === 'string')
    .map(([name, val]) => ({ name, value: val }));

  return pairs.length > 0 ? pairs : undefined;
}

function resolveCodexStdioEnv(transport: CodexMcpListEntry['transport']): Record<string, string> | undefined {
  const merged: Record<string, string> = {};

  if (transport.env) {
    for (const [name, value] of Object.entries(transport.env)) {
      if (typeof name === 'string' && typeof value === 'string') {
        merged[name] = value;
      }
    }
  }

  if (Array.isArray(transport.env_vars)) {
    for (const envName of transport.env_vars) {
      const value = process.env[envName];
      if (typeof value === 'string' && value.length > 0 && !merged[envName]) {
        merged[envName] = value;
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function resolveCodexHttpHeaders(
  serverName: string,
  transport: CodexMcpListEntry['transport']
): Record<string, string> | undefined {
  const merged: Record<string, string> = {};

  if (transport.http_headers) {
    for (const [name, value] of Object.entries(transport.http_headers)) {
      if (typeof name === 'string' && typeof value === 'string') {
        merged[name] = value;
      }
    }
  }

  if (transport.env_http_headers) {
    for (const [headerName, envName] of Object.entries(transport.env_http_headers)) {
      if (typeof headerName !== 'string' || typeof envName !== 'string') continue;
      const value = process.env[envName];
      if (typeof value === 'string' && value.length > 0) {
        merged[headerName] = value;
      }
    }
  }

  const bearerEnvVar = transport.bearer_token_env_var?.trim();
  if (bearerEnvVar && !merged.Authorization) {
    const token = process.env[bearerEnvVar]?.trim();
    if (token) {
      merged.Authorization = `Bearer ${token}`;
    }
  }

  return resolveAppOwnedMcpHeaders({
    serverName,
    serverUrl: transport.url,
    headers: Object.keys(merged).length > 0 ? merged : undefined
  });
}

function normalizeCodexTools(tools: McpToolInfo[]): McpToolInfo[] {
  const unique = new Map<string, McpToolInfo>();
  for (const tool of tools) {
    if (typeof tool?.name === 'string' && tool.name.trim()) {
      const name = tool.name.trim();
      unique.set(name, {
        name,
        ...(tool.description ? { description: tool.description } : {})
      });
    }
  }
  return [...unique.values()];
}

async function fetchCodexMcpTools(entry: CodexMcpListEntry): Promise<McpToolInfo[]> {
  const transportType = entry.transport.type.trim().toLowerCase();
  const timeoutPromise = new Promise<McpToolInfo[]>((_, reject) =>
    setTimeout(() => reject(new Error('Timeout')), CODEX_MCP_TOOLS_FETCH_TIMEOUT_MS)
  );

  const fetchPromise = (async (): Promise<McpToolInfo[]> => {
    if (transportType === 'stdio') {
      const command = entry.transport.command?.trim();
      if (!command) return [];
      return await fetchMcpToolsStdio({
        command,
        args: entry.transport.args || undefined,
        env: resolveCodexStdioEnv(entry.transport)
      });
    }

    if (transportType === 'streamable_http' || transportType === 'http' || transportType === 'sse') {
      const url = entry.transport.url?.trim();
      if (!url) return [];
      return await fetchMcpTools(url, resolveCodexHttpHeaders(entry.name, entry.transport));
    }

    return [];
  })();

  try {
    const tools = await Promise.race([fetchPromise, timeoutPromise]);
    console.log(
      `[churro-coder] Codex MCP probe server=${entry.name} transport=${transportType} toolCount=${tools.length}`
    );
    return normalizeCodexTools(tools);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[churro-coder] Codex MCP probe failed server=${entry.name} transport=${transportType}: ${message}`);
    return [];
  }
}

function resolveCodexLookupPath(pathCandidate: string | null | undefined): string {
  return pathCandidate && pathCandidate.trim() ? pathCandidate.trim() : '__global__';
}

function getCodexMcpFingerprint(servers: CodexMcpServerForSession[]): string {
  return createHash('sha256').update(JSON.stringify(servers)).digest('hex');
}

async function resolveCodexMcpSnapshot(params: {
  lookupPath?: string | null;
  forceRefresh?: boolean;
  includeTools?: boolean;
}): Promise<CodexMcpSnapshot> {
  const lookupPath = resolveCodexLookupPath(params.lookupPath);
  const cached = codexMcpCache.get(lookupPath);
  const shouldIncludeTools = Boolean(params.includeTools);
  if (cached && !params.forceRefresh && (!shouldIncludeTools || cached.toolsResolved)) {
    return cached;
  }

  const result = await runCodexCliChecked(['mcp', 'list', '--json'], {
    cwd: lookupPath === '__global__' ? undefined : lookupPath
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error('Failed to parse Codex MCP list JSON output.');
  }

  const entries = z.array(codexMcpListEntrySchema).parse(parsed);
  const mcpServersForSession: CodexMcpServerForSession[] = [];
  const mcpServersForSettings: CodexMcpServerForSettings[] = [];

  const convertedEntries = await Promise.all(
    entries.map(async (entry) => {
      const transportType = entry.transport.type.trim().toLowerCase();
      const authState = getCodexMcpAuthState(entry.auth_status);
      const includeInSession = entry.enabled;
      const resolvedStdioEnv = resolveCodexStdioEnv(entry.transport);
      const resolvedHttpHeaders = resolveCodexHttpHeaders(entry.name, entry.transport);
      let status: CodexMcpServerForSettings['status'] = !entry.enabled
        ? 'failed'
        : authState.needsAuth
          ? 'needs-auth'
          : 'connected';

      const settingsConfig: Record<string, unknown> = {
        transportType: entry.transport.type,
        authStatus: entry.auth_status ?? 'unknown',
        enabled: entry.enabled,
        disabledReason: entry.disabled_reason ?? undefined
      };

      let sessionServer: CodexMcpServerForSession | null = null;
      if (transportType === 'stdio') {
        const command = entry.transport.command || undefined;
        const args = entry.transport.args || undefined;
        if (includeInSession && command) {
          const envPairs = objectToPairs(resolvedStdioEnv) || [];
          sessionServer = {
            name: entry.name,
            type: 'stdio',
            command,
            args: Array.isArray(args) ? args : [],
            env: envPairs
          };
        }

        settingsConfig.command = command;
        settingsConfig.args = args;
        settingsConfig.env = entry.transport.env || undefined;
        settingsConfig.envVars = entry.transport.env_vars || undefined;
      } else if (transportType === 'streamable_http' || transportType === 'http' || transportType === 'sse') {
        const url = entry.transport.url || undefined;
        const headers = objectToPairs(resolvedHttpHeaders);
        if (includeInSession && url) {
          sessionServer = {
            name: entry.name,
            type: 'http',
            url,
            headers: headers || []
          };
        }

        settingsConfig.url = url;
        settingsConfig.headers = entry.transport.http_headers || undefined;
        settingsConfig.envHttpHeaders = entry.transport.env_http_headers || undefined;
        settingsConfig.bearerTokenEnvVar = entry.transport.bearer_token_env_var || undefined;
      }

      const shouldProbeTools =
        shouldIncludeTools &&
        includeInSession &&
        !authState.needsAuth &&
        // Probe unauthenticated/public servers and stdio servers.
        (!authState.supportsAuth ||
          transportType === 'stdio' ||
          // For auth-capable HTTP, only probe if explicit auth header is available.
          Boolean(resolvedHttpHeaders?.Authorization));
      const tools = shouldProbeTools ? await fetchCodexMcpTools(entry) : [];
      if (shouldProbeTools && tools.length === 0) {
        status = 'failed';
      }

      return {
        sessionServer,
        settingsServer: {
          name: entry.name,
          status,
          tools,
          needsAuth: authState.needsAuth,
          config: settingsConfig
        } satisfies CodexMcpServerForSettings
      };
    })
  );

  for (const converted of convertedEntries) {
    if (converted.sessionServer) {
      mcpServersForSession.push(converted.sessionServer);
    }
    mcpServersForSettings.push(converted.settingsServer);
  }

  const snapshot: CodexMcpSnapshot = {
    mcpServersForSession,
    groups: [
      {
        groupName: 'Global',
        projectPath: null,
        mcpServers: mcpServersForSettings
      }
    ],
    fingerprint: getCodexMcpFingerprint(mcpServersForSession),
    fetchedAt: Date.now(),
    toolsResolved: shouldIncludeTools
  };

  codexMcpCache.set(lookupPath, snapshot);
  return snapshot;
}

function clearCodexMcpCache(): void {
  codexMcpCache.clear();
}

function formatChurroCoderMcpStatusForLog(status: ChurroCoderMcpStatus): string {
  switch (status.state) {
    case 'ready':
      return `state=ready serverName=${status.serverName} url=${status.url}`;
    case 'failed':
      return `state=failed serverName=${status.serverName} error=${JSON.stringify(status.error)}`;
    default:
      return `state=${status.state}`;
  }
}

function setChurroCoderMcpStatus(nextStatus: ChurroCoderMcpStatus, reason: string): void {
  const previous = churroCoderMcpStatus;
  churroCoderMcpStatus = nextStatus;
  console.log(
    `[churro-coder] MCP bootstrap status from=${formatChurroCoderMcpStatusForLog(previous)} to=${formatChurroCoderMcpStatusForLog(nextStatus)} reason=${reason}`
  );
}

function getCodexServerIdentity(server: CodexMcpServerForSettings): string {
  const config = server.config as Record<string, unknown>;
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
    authStatus: config.authStatus ?? null
  });
}

export async function getAllCodexMcpConfigHandler() {
  const globalSnapshot = await resolveCodexMcpSnapshot({ includeTools: true });
  const globalServers = globalSnapshot.groups[0]?.mcpServers || [];
  const globalByName = new Map(globalServers.map((server) => [server.name, getCodexServerIdentity(server)]));

  const groups: CodexMcpSnapshot['groups'] = [...globalSnapshot.groups];

  // Only enumerate projects the app knows about (DB-backed projects).
  // Do not scan ~/.codex/config.toml project entries.
  const projectPathSet = new Set<string>();

  try {
    const db = getDatabase();
    const dbProjects = db.select({ path: projectsTable.path }).from(projectsTable).all();
    for (const project of dbProjects) {
      if (typeof project.path === 'string' && project.path.trim().length > 0) {
        projectPathSet.add(project.path);
      }
    }
  } catch (error) {
    console.error('[codex.getAllMcpConfig] Failed to read projects from DB:', error);
  }

  const projectPaths = [...projectPathSet].sort((a, b) => a.localeCompare(b));
  const projectResults = await Promise.allSettled(
    projectPaths.map(async (projectPath) => {
      const projectSnapshot = await resolveCodexMcpSnapshot({
        lookupPath: projectPath,
        includeTools: true
      });
      const effectiveServers = projectSnapshot.groups[0]?.mcpServers || [];
      const projectOnlyServers = effectiveServers.filter((server) => {
        const globalIdentity = globalByName.get(server.name);
        if (!globalIdentity) return true;
        return globalIdentity !== getCodexServerIdentity(server);
      });

      if (projectOnlyServers.length === 0) {
        return null;
      }

      return {
        groupName: basename(projectPath) || projectPath,
        projectPath,
        mcpServers: projectOnlyServers
      };
    })
  );

  for (const result of projectResults) {
    if (result.status === 'fulfilled' && result.value) {
      groups.push(result.value);
      continue;
    }
    if (result.status === 'rejected') {
      console.error('[codex.getAllMcpConfig] Failed to resolve project MCP snapshot:', result.reason);
    }
  }

  return { groups };
}

function normalizeCodexIntegrationState(rawOutput: string): CodexIntegrationState {
  const normalizedOutput = rawOutput.toLowerCase();

  if (normalizedOutput.includes('logged in using chatgpt')) {
    return 'connected_chatgpt';
  }

  if (normalizedOutput.includes('logged in using an api key') || normalizedOutput.includes('logged in using api key')) {
    return 'connected_api_key';
  }

  if (normalizedOutput.includes('not logged in')) {
    return 'not_logged_in';
  }

  return 'unknown';
}

function parseStoredMessages(raw: string | null | undefined): any[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function extractPromptFromStoredMessage(message: any): string {
  if (!message || !Array.isArray(message.parts)) return '';

  const textParts: string[] = [];
  const fileContents: string[] = [];

  for (const part of message.parts) {
    if (part?.type === 'text' && typeof part.text === 'string') {
      textParts.push(part.text);
    } else if (part?.type === 'file-content') {
      const filePath = typeof part.filePath === 'string' ? part.filePath : undefined;
      const fileName = filePath?.split('/').pop() || filePath || 'file';
      const content = typeof part.content === 'string' ? part.content : '';
      fileContents.push(`\n--- ${fileName} ---\n${content}`);
    }
  }

  return textParts.join('\n') + fileContents.join('');
}

function getLastSessionId(messages: any[]): string | undefined {
  // Only resume a Codex session — skip assistant messages from Claude or other
  // providers to avoid passing a Claude session UUID to app-server which
  // would return "Resource not found".
  const lastCodexAssistant = [...messages]
    .reverse()
    .find((message) => message?.role === 'assistant' && getProviderForModelId(message?.metadata?.model) === 'codex');
  const sessionId = lastCodexAssistant?.metadata?.sessionId;
  return typeof sessionId === 'string' ? sessionId : undefined;
}

function extractCodexModelId(rawModel: unknown): string | undefined {
  if (typeof rawModel !== 'string' || rawModel.length === 0) {
    return undefined;
  }

  const normalizedModel = rawModel.trim();

  if (!normalizedModel || normalizedModel === 'codex') {
    return undefined;
  }

  return normalizedModel;
}

function preprocessCodexModelName(params: { modelId: string; authConfig?: { apiKey: string } }): string {
  const hasAppManagedApiKey = Boolean(params.authConfig?.apiKey?.trim());
  if (!hasAppManagedApiKey) {
    return params.modelId;
  }

  // All model IDs now match the real API; pass through as-is
  return params.modelId;
}

function getAuthFingerprint(authConfig?: { apiKey: string }): string | null {
  const apiKey = authConfig?.apiKey?.trim();
  if (!apiKey) return null;
  return createHash('sha256').update(apiKey).digest('hex');
}

function buildCodexProviderEnv(authConfig?: { apiKey: string }): Record<string, string> {
  // Prefer shell-derived values (notably PATH) so stdio MCP dependencies
  // like pipx/npx resolve the same way as in MCP tool probing.
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }

  const shellEnv = getClaudeShellEnvironment();
  for (const [key, value] of Object.entries(shellEnv)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }

  env.CLAUDE_CODE_ENABLE_TASKS = 'true';
  const currentMcpBearer = getMcpHttpEndpoint()?.bearer || process.env.CHURRO_MCP_BEARER || '';
  if (currentMcpBearer) {
    env.CHURRO_MCP_BEARER = currentMcpBearer;
  }

  const apiKey = authConfig?.apiKey?.trim();
  if (!apiKey) {
    return env;
  }

  return {
    ...env,
    CODEX_API_KEY: apiKey
  };
}

function buildUserParts(
  prompt: string,
  images:
    | Array<{
        base64Data?: string;
        mediaType?: string;
        filename?: string;
      }>
    | undefined
): any[] {
  const parts: any[] = [{ type: 'text', text: prompt }];

  if (images && images.length > 0) {
    for (const image of images) {
      if (!image.base64Data || !image.mediaType) continue;
      parts.push({
        type: 'data-image',
        data: {
          base64Data: image.base64Data,
          mediaType: image.mediaType,
          filename: image.filename
        }
      });
    }
  }

  return parts;
}

function normalizeCodexQuestions(questions: z.infer<typeof codexQuestionSchema>[]) {
  return questions.map((question) => ({
    question: question.question,
    header: question.header,
    options: question.options.map((option) => ({
      label: option.label,
      description: option.description || ''
    })),
    multiSelect: Boolean(question.multiSelect)
  }));
}

function normalizeCodexPlan(plan: z.infer<typeof codexPlanSchema>) {
  return {
    ...plan,
    id: plan.id || `plan-${Date.now()}`,
    summary: sanitizeCodexPlanSummary(plan.summary),
    status: 'awaiting_approval' as const,
    steps: plan.steps.map((step, index) => ({
      ...step,
      id: step.id || `step-${index + 1}`,
      status: step.status || 'pending'
    }))
  };
}

function getAssistantText(message: any): string {
  if (!message || !Array.isArray(message.parts)) return '';
  return message.parts
    .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
    .map((part: any) => part.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

function isCodexPlanWritePart(part: any): boolean {
  const inputToolName = typeof part?.input?.toolName === 'string' ? part.input.toolName : '';
  return (
    part?.type === 'tool-PlanWrite' ||
    part?.toolName === 'PlanWrite' ||
    inputToolName === 'PlanWrite' ||
    inputToolName.startsWith('PlanWrite ') ||
    inputToolName.endsWith('/PlanWrite')
  );
}

function parseMcpContentJson(value: any): any | null {
  const content = Array.isArray(value?.content) ? value.content : [];
  const firstText = content.find((item: any) => typeof item?.text === 'string');
  if (!firstText?.text) return null;

  try {
    return JSON.parse(firstText.text);
  } catch {
    return null;
  }
}

function getPlanFromPlanWritePart(part: any): any | null {
  const candidates = [
    part?.input?.plan,
    part?.input?.args?.plan,
    part?.input?.arguments?.plan,
    part?.args?.plan,
    part?.output?.plan,
    part?.result?.plan,
    part?.output?.structuredContent?.plan,
    part?.result?.structuredContent?.plan,
    parseMcpContentJson(part?.output)?.plan,
    parseMcpContentJson(part?.result)?.plan
  ];

  return candidates.find((plan) => plan && typeof plan === 'object') || null;
}

function hasUsableCodexPlanWritePart(message: any): boolean {
  if (!message || !Array.isArray(message.parts)) return false;
  return message.parts.some((part: any) => {
    if (!isCodexPlanWritePart(part)) return false;
    if (part.state === 'output-error') return false;
    if (part.errorText || part.error) return false;

    const plan = getPlanFromPlanWritePart(part);
    if (!plan) return false;

    return part.output !== undefined || part.result !== undefined;
  });
}

function findPlanFromAnyPlanWritePart(message: any): any | null {
  if (!message || !Array.isArray(message.parts)) return null;

  for (const part of message.parts) {
    if (!isCodexPlanWritePart(part)) continue;
    const plan = getPlanFromPlanWritePart(part);
    if (plan) return plan;
  }

  return null;
}

function extractPlanStepTitles(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const steps: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(?:\d+[\).\:-]|\-|\*)\s+(.+)$/);
    if (!match) continue;

    const title = match[1].replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    if (title.length < 4) continue;

    steps.push(title.length > 120 ? `${title.slice(0, 117)}...` : title);
  }

  return steps.slice(0, 8);
}

function buildFallbackPlanWritePart(params: { prompt: string; text: string; plan?: any }): any {
  const now = Date.now();
  const toolCallId = `codex-planwrite-fallback-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const requestSummary = params.prompt.trim().replace(/\s+/g, ' ');
  const shortRequest = requestSummary.length > 140 ? `${requestSummary.slice(0, 137)}...` : requestSummary;
  const stepTitles = extractPlanStepTitles(params.text);
  const fallbackStepTitles =
    stepTitles.length > 0
      ? stepTitles
      : [
          'Confirm the existing project structure and constraints',
          shortRequest ? `Implement the requested change: ${shortRequest}` : 'Implement the requested change',
          'Add the expected interaction, state handling, and edge-case behavior',
          'Verify the result through the relevant local run or manual check'
        ];

  const plan = normalizeCodexPlan(
    params.plan && typeof params.plan === 'object'
      ? {
          ...params.plan,
          steps: Array.isArray(params.plan.steps)
            ? params.plan.steps
            : fallbackStepTitles.map((title) => ({ title, status: 'pending' }))
        }
      : {
          id: `plan-${now}`,
          title: shortRequest ? `Plan: ${shortRequest}` : 'Implementation plan',
          summary: sanitizeCodexPlanSummary(params.text) || `Plan for: ${requestSummary || 'the requested change'}`,
          status: 'awaiting_approval',
          steps: fallbackStepTitles.map((title) => ({
            title,
            status: 'pending'
          }))
        }
  );
  const output = {
    success: true,
    message: 'Plan ready for review.',
    action: 'create',
    plan,
    synthesized: true
  };

  return {
    type: 'tool-PlanWrite',
    toolCallId,
    toolName: 'PlanWrite',
    state: 'output-available',
    input: {
      action: 'create',
      plan
    },
    output,
    result: output,
    startedAt: now
  };
}

function ensurePlanWriteForCodexPlanMode(params: { messages: any[]; prompt: string; fallbackPart: any | null }): {
  messages: any[];
  fallbackPart: any | null;
} {
  let lastAssistantIndex = -1;
  for (let index = params.messages.length - 1; index >= 0; index--) {
    if (params.messages[index]?.role === 'assistant') {
      lastAssistantIndex = index;
      break;
    }
  }
  if (lastAssistantIndex === -1) {
    return { messages: params.messages, fallbackPart: params.fallbackPart };
  }

  const lastAssistant = params.messages[lastAssistantIndex];
  if (hasUsableCodexPlanWritePart(lastAssistant)) {
    return { messages: params.messages, fallbackPart: null };
  }

  const planFromFailedPlanWrite = findPlanFromAnyPlanWritePart(lastAssistant);
  const fallbackPart =
    params.fallbackPart ||
    buildFallbackPlanWritePart({
      prompt: params.prompt,
      text: getAssistantText(lastAssistant),
      plan: planFromFailedPlanWrite
    });
  const updatedAssistant = {
    ...lastAssistant,
    parts: [...(lastAssistant.parts || []), fallbackPart]
  };
  const messages = [...params.messages];
  messages[lastAssistantIndex] = updatedAssistant;

  return { messages, fallbackPart };
}

type CodexPlanStreamAccumulator = {
  currentText: string;
  parts: any[];
  toolPartsByCallId: Map<string, any>;
};

function createCodexPlanStreamAccumulator(): CodexPlanStreamAccumulator {
  return {
    currentText: '',
    parts: [],
    toolPartsByCallId: new Map()
  };
}

function flushCodexPlanText(accumulator: CodexPlanStreamAccumulator) {
  const text = accumulator.currentText.trim();
  if (text) {
    accumulator.parts.push({ type: 'text', text });
  }
  accumulator.currentText = '';
}

function upsertCodexPlanToolPart(accumulator: CodexPlanStreamAccumulator, chunk: any): any | null {
  const toolCallId = typeof chunk?.toolCallId === 'string' ? chunk.toolCallId : '';
  if (!toolCallId) return null;

  let part = accumulator.toolPartsByCallId.get(toolCallId);
  if (!part) {
    const toolName = typeof chunk.toolName === 'string' && chunk.toolName.length > 0 ? chunk.toolName : 'unknown';
    part = {
      type: `tool-${toolName}`,
      toolCallId,
      toolName,
      state: 'input-streaming',
      startedAt: Date.now()
    };
    accumulator.toolPartsByCallId.set(toolCallId, part);
    accumulator.parts.push(part);
  }

  if (typeof chunk.toolName === 'string' && chunk.toolName.length > 0) {
    part.toolName = chunk.toolName;
    part.type = `tool-${chunk.toolName}`;
  }
  if (chunk.input !== undefined) {
    part.input = chunk.input;
  }
  if (typeof chunk.title === 'string' && chunk.title.length > 0) {
    part.title = chunk.title;
  }

  return part;
}

function accumulateCodexPlanStreamChunk(accumulator: CodexPlanStreamAccumulator, chunk: any) {
  if (!chunk || typeof chunk !== 'object') return;

  switch (chunk.type) {
    case 'text-delta':
      accumulator.currentText += chunk.delta || '';
      break;
    case 'text-end':
      flushCodexPlanText(accumulator);
      break;
    case 'tool-input-start': {
      const part = upsertCodexPlanToolPart(accumulator, chunk);
      if (part) part.state = 'input-streaming';
      break;
    }
    case 'tool-input-available': {
      const part = upsertCodexPlanToolPart(accumulator, chunk);
      if (part) part.state = 'input-available';
      break;
    }
    case 'tool-input-error': {
      const part = upsertCodexPlanToolPart(accumulator, chunk);
      if (part) {
        part.state = 'input-error';
        part.errorText = chunk.errorText;
      }
      break;
    }
    case 'tool-output-available': {
      const part = typeof chunk.toolCallId === 'string' ? accumulator.toolPartsByCallId.get(chunk.toolCallId) : null;
      if (part) {
        part.state = 'output-available';
        part.output = chunk.output;
        part.result = chunk.output;
      }
      break;
    }
    case 'tool-output-error': {
      const part = typeof chunk.toolCallId === 'string' ? accumulator.toolPartsByCallId.get(chunk.toolCallId) : null;
      if (part) {
        part.state = 'output-error';
        part.errorText = chunk.errorText;
      }
      break;
    }
    case 'tool-output-denied': {
      const part = typeof chunk.toolCallId === 'string' ? accumulator.toolPartsByCallId.get(chunk.toolCallId) : null;
      if (part) {
        part.state = 'output-error';
        part.errorText = 'Tool output denied';
      }
      break;
    }
  }
}

function isAppServerRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

function getStringField(value: unknown, keys: string[]): string | undefined {
  if (!isAppServerRecord(value)) return undefined;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function getAppServerThreadId(value: unknown): string | undefined {
  if (!isAppServerRecord(value)) return undefined;
  return (
    getStringField(value, ['threadId', 'thread_id']) ||
    getStringField(value.thread, ['id', 'threadId', 'thread_id']) ||
    getStringField(value.turn, ['threadId', 'thread_id'])
  );
}

function getAppServerTurnId(value: unknown): string | undefined {
  if (!isAppServerRecord(value)) return undefined;
  return getStringField(value, ['turnId', 'turn_id']) || getStringField(value.turn, ['id', 'turnId', 'turn_id']);
}

function getAppServerItemId(value: unknown): string {
  if (!isAppServerRecord(value)) return crypto.randomUUID();
  return (
    getStringField(value, ['itemId', 'item_id', 'id', 'callId', 'call_id']) ||
    getStringField(value.item, ['id', 'itemId', 'item_id', 'callId', 'call_id']) ||
    crypto.randomUUID()
  );
}

function getAppServerSessionKey(authConfig?: { apiKey: string }): string {
  return getAuthFingerprint(authConfig) || 'codex-chatgpt';
}

async function getOrCreateAppServerSession(params: {
  authConfig?: { apiKey: string };
}): Promise<CodexAppServerSession> {
  const sessionKey = getAppServerSessionKey(params.authConfig);
  const authFingerprint = getAuthFingerprint(params.authConfig);
  const currentMcpBearer = getMcpHttpEndpoint()?.bearer || process.env.CHURRO_MCP_BEARER || null;
  const existing = appServerSessions.get(sessionKey);

  if (existing && existing.authFingerprint === authFingerprint && existing.mcpBearer === currentMcpBearer) {
    await existing.client.ensureInitialized();
    return existing;
  }

  if (existing) {
    const authChanged = existing.authFingerprint !== authFingerprint;
    const bearerChanged = existing.mcpBearer !== currentMcpBearer;
    const reason = authChanged && bearerChanged ? 'both' : authChanged ? 'auth' : 'bearer';
    console.log(
      `[churro-coder] Codex app-server session invalidated reason=${reason} sessionKey=${sessionKey} hadBearer=${Boolean(existing.mcpBearer)} hasBearer=${Boolean(currentMcpBearer)}`
    );
  }

  // We intentionally do NOT issue per-thread `thread/unsubscribe` requests when
  // tearing down the shared session: `client.dispose()` SIGTERMs the process
  // and the server frees subscribed threads on connection drop. Sending RPCs
  // here would just race the SIGTERM and log misleading "succeeded" lines.
  // The per-sub-chat unsubscribe in `cleanupCodexAppServerSubChat` is the path
  // that keeps a live session lean.
  existing?.client.dispose();
  appServerSessions.delete(sessionKey);

  let session: CodexAppServerSession | null = null;
  const client = new CodexAppServerClient({
    command: resolveBundledCodexCliPath(),
    clientInfoVersion: app.getVersion(),
    args: ['app-server'],
    env: buildCodexProviderEnv(params.authConfig),
    onActivity: () => {
      session!.lastActivityAt = Date.now();
    },
    onNotification: handleAppServerNotification,
    onServerRequest: handleAppServerServerRequest,
    onExit: () => {
      const current = appServerSessions.get(sessionKey);
      if (current?.client === client) {
        appServerSessions.delete(sessionKey);
      }
    }
  });

  session = {
    client,
    authFingerprint,
    mcpBearer: currentMcpBearer,
    lastActivityAt: Date.now()
  };
  appServerSessions.set(sessionKey, session);
  await client.ensureInitialized();
  return session;
}

/**
 * Force-dispose the cached Codex app-server for the given auth fingerprint.
 * Used by the chat retry loop when repeated failures suggest the underlying
 * process is wedged and needs a clean restart. Pending JSON-RPC calls reject
 * with `CodexAppServerClosedError`.
 *
 * The app-server is shared across every sub-chat that uses the same auth
 * fingerprint, so we skip the dispose when *another* sub-chat is currently
 * streaming through it - tearing down the shared process would surface
 * `CodexAppServerClosedError` toasts in unrelated chats. The current chat
 * still retries; if the process really is dead, its own pending RPCs will
 * already have rejected and the next attempt will spawn fresh on cache miss
 * via the existing `onExit` eviction.
 */
function disposeAppServerSessionForAuth(
  authConfig?: { apiKey: string },
  reason = 'recovery-restart',
  excludeSubChatId?: string
): void {
  const sessionKey = getAppServerSessionKey(authConfig);
  const existing = appServerSessions.get(sessionKey);
  if (!existing) return;

  for (const [otherSubChatId, otherStream] of activeStreams) {
    if (otherSubChatId === excludeSubChatId) continue;
    if (otherStream.client === existing.client && !otherStream.controller.signal.aborted) {
      console.log(
        `[codex] skip force-restart sessionKey=${sessionKey.slice(0, 8)} ` +
          `reason=${reason} other=${otherSubChatId.slice(-8)}`
      );
      return;
    }
  }

  console.log(`[codex] app-server force restart sessionKey=${sessionKey.slice(0, 8)} reason=${reason}`);
  // No per-thread `thread/unsubscribe` here either — see the explanation in
  // `getOrCreateAppServerSession`. Connection drop frees server memory.
  existing.client.dispose(reason);
  appServerSessions.delete(sessionKey);
}

export function cleanupCodexAppServerSubChat(subChatId: string): void {
  const sessionKey = subChatSessionKeys.get(subChatId);
  const activeStream = activeStreams.get(subChatId);
  const client = (sessionKey ? appServerSessions.get(sessionKey)?.client : null) || activeStream?.client || null;
  cleanupCodexThreadSubscription(
    {
      subChatThreadIds,
      subChatSessionKeys,
      activeStreamsByThreadId,
      activeAppServerTurns,
      activeThreadIdsByTurnId
    },
    {
      subChatId,
      notifyThreadUnsubscribe: client
        ? (threadId) => notifyThreadUnsubscribe(client, { threadId }, 'subchat-cleanup')
        : undefined
    }
  );
}

function getSandboxPolicyForAppServerRequest(params: Record<string, unknown>): CodexSandboxPolicy | undefined {
  const threadId = getAppServerThreadId(params);
  if (!threadId) return undefined;
  const subChatId = activeStreamsByThreadId.get(threadId);
  if (!subChatId) return undefined;
  return activeStreams.get(subChatId)?.sandboxPolicy;
}

const THREAD_UNSUBSCRIBE_TIMEOUT_MS = 5_000;

/**
 * `thread/unsubscribe` is a `ClientRequest` in the app-server schema (it has a
 * `ThreadUnsubscribeResponse`), so it must be sent as a JSON-RPC request, not
 * a notification — a strict server may discard a method-as-notification. We
 * still don't care about the response, so the promise is fire-and-forget; we
 * only log if the request itself fails.
 */
function notifyThreadUnsubscribe(client: CodexAppServerClient, params: ThreadUnsubscribeParams, reason: string): void {
  console.log(`[codex app-server] request method=thread/unsubscribe reason=${reason} threadId=${params.threadId}`);
  client.request('thread/unsubscribe', params, THREAD_UNSUBSCRIBE_TIMEOUT_MS).catch((error: unknown) => {
    if (error instanceof CodexAppServerClosedError) return;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[codex app-server] request failed method=thread/unsubscribe reason=${reason} threadId=${params.threadId} error=${message}`
    );
  });
}

function extractThreadIdFromStartResult(result: unknown): string | undefined {
  return getAppServerThreadId(result) || getStringField(result, ['id', 'threadId', 'thread_id']);
}

function extractTurnIdFromStartResult(result: unknown): string | undefined {
  return getAppServerTurnId(result) || getStringField(result, ['id', 'turnId', 'turn_id']);
}

function splitCodexModelAndEffort(modelId: string): {
  model: string;
  effort?: string;
} {
  const [model, effort] = modelId.split('/', 2);
  return {
    model: model || modelId,
    ...(effort ? { effort } : {})
  };
}

function buildAppServerInput(
  prompt: string,
  images:
    | Array<{
        base64Data?: string;
        mediaType?: string;
        filename?: string;
      }>
    | undefined
): any[] {
  const input: any[] = [{ type: 'text', text: prompt }];

  if (images && images.length > 0) {
    for (const image of images) {
      if (!image.base64Data || !image.mediaType) continue;
      input.push({
        type: 'image',
        url: `data:${image.mediaType};base64,${image.base64Data}`,
        ...(image.filename ? { filename: image.filename } : {})
      });
    }
  }

  return input;
}

function buildCodexBaseConfig(params: { cwd: string; selectedModelId: string }) {
  const { model, effort } = splitCodexModelAndEffort(params.selectedModelId);
  return {
    cwd: params.cwd,
    model,
    ...(effort ? { effort } : {}),
    personality: 'pragmatic'
  };
}

function buildCodexThreadConfig(params: { cwd: string; selectedModelId: string }) {
  return {
    ...buildCodexBaseConfig(params),
    approvalPolicy: 'never',
    serviceName: 'churro-coder',
    persistExtendedHistory: true
  };
}

function buildCodexTurnConfig(params: {
  cwd: string;
  mode: 'plan' | 'execute' | 'explore';
  selectedModelId: string;
  sandboxEnabled?: boolean;
  writableRoots?: string[];
}) {
  return {
    ...buildCodexBaseConfig(params),
    approvalPolicy: 'never',
    sandboxPolicy: buildCodexSandboxPolicy(params.mode, params.sandboxEnabled ?? false, params.writableRoots ?? [])
  };
}

async function startOrResumeAppServerThread(params: {
  client: CodexAppServerClient;
  threadId?: string;
  cwd: string;
  selectedModelId: string;
}): Promise<string> {
  const config = buildCodexThreadConfig({
    cwd: params.cwd,
    selectedModelId: params.selectedModelId
  });

  const result = params.threadId
    ? await params.client.request('thread/resume', {
        threadId: params.threadId,
        excludeTurns: true,
        ...config
      })
    : await params.client.request('thread/start', config);

  const threadId = extractThreadIdFromStartResult(result);
  if (!threadId) {
    throw new Error('Codex app-server did not return a thread id');
  }

  return threadId;
}

async function interruptCodexTurn(stream: ActiveCodexStream): Promise<void> {
  if (!stream.client || !stream.threadId) return;

  try {
    await stream.client.request(
      'turn/interrupt',
      {
        threadId: stream.threadId,
        ...(stream.turnId ? { turnId: stream.turnId } : {})
      },
      10_000
    );
  } catch (error) {
    console.warn('[codex] Failed to interrupt app-server turn:', error);
  }
}

function getAccumulatorForNotification(notification: CodexAppServerNotification): AppServerTurnAccumulator | null {
  const params = notification.params;
  const threadId = getAppServerThreadId(params) || activeThreadIdsByTurnId.get(getAppServerTurnId(params) || '');
  if (!threadId) return null;
  return activeAppServerTurns.get(threadId) || null;
}

function emitTextDelta(accumulator: AppServerTurnAccumulator, delta: string) {
  if (!delta) return;
  if (!accumulator.currentTextId) {
    accumulator.currentTextId = `text-${crypto.randomUUID()}`;
    accumulator.safeEmit({ type: 'text-start', id: accumulator.currentTextId });
  }
  accumulator.currentText += delta;
  accumulator.safeEmit({
    type: 'text-delta',
    id: accumulator.currentTextId,
    delta
  });
}

function flushTextPart(accumulator: AppServerTurnAccumulator) {
  const text = accumulator.currentText;
  if (!text) return;
  accumulator.parts.push({ type: 'text', text });
  if (accumulator.currentTextId) {
    accumulator.safeEmit({ type: 'text-end', id: accumulator.currentTextId });
  }
  accumulator.currentText = '';
  accumulator.currentTextId = null;
}

function emitToolStart(accumulator: AppServerTurnAccumulator, part: any, input?: unknown) {
  accumulator.toolPartsByItemId.set(part.toolCallId, part);
  accumulator.parts.push(part);
  accumulator.safeEmit({
    type: 'tool-input-start',
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    providerMetadata: {
      custom: {
        startedAt: part.startedAt
      }
    }
  });
  if (input !== undefined) {
    part.input = input;
    part.state = 'input-available';
    accumulator.safeEmit({
      type: 'tool-input-available',
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      input,
      providerMetadata: {
        custom: {
          startedAt: part.startedAt
        }
      }
    });
  }
}

function updateToolOutput(
  accumulator: AppServerTurnAccumulator,
  toolCallId: string,
  output: unknown,
  state = 'output-available'
) {
  const part = accumulator.toolPartsByItemId.get(toolCallId);
  if (!part) return;

  part.state = state;
  part.output = output;
  part.result = output;
  accumulator.safeEmit({
    type: state === 'output-error' ? 'tool-output-error' : 'tool-output-available',
    toolCallId,
    ...(state === 'output-error' ? { errorText: extractCodexError(output).message } : { output })
  });
}

function getCommandText(item: any): string {
  const command = item?.command;
  if (Array.isArray(command)) return command.join(' ');
  if (typeof command === 'string') return command;
  if (Array.isArray(item?.commandActions)) {
    const action = item.commandActions.find((entry: any) => entry?.command);
    if (Array.isArray(action?.command)) return action.command.join(' ');
    if (typeof action?.command === 'string') return action.command;
  }
  return '';
}

function toCommandOutput(item: any, streamingOutput?: string) {
  const aggregatedOutput =
    typeof item?.aggregatedOutput === 'string'
      ? item.aggregatedOutput
      : typeof streamingOutput === 'string'
        ? streamingOutput
        : '';

  return {
    stdout: aggregatedOutput,
    stderr: '',
    output: aggregatedOutput,
    exitCode:
      typeof item?.exitCode === 'number'
        ? item.exitCode
        : item?.status === 'failed'
          ? 1
          : item?.status === 'declined'
            ? 1
            : item?.status === 'completed'
              ? 0
              : undefined,
    status: item?.status,
    durationMs: item?.durationMs
  };
}

function createCommandPart(item: any): any {
  const toolCallId = getAppServerItemId(item);
  return {
    type: 'tool-Bash',
    toolCallId,
    toolName: 'Bash',
    state: 'input-available',
    input: {
      command: getCommandText(item),
      cwd: item?.cwd,
      commandActions: item?.commandActions
    },
    startedAt: Date.now(),
    outputText: ''
  };
}

function getFileChangeKind(item: any): 'Write' | 'Edit' {
  const changes = Array.isArray(item?.changes) ? item.changes : [];
  const firstChange = changes[0];
  const kind = String(firstChange?.kind || item?.kind || '').toLowerCase();
  if (kind.includes('add') || kind.includes('create') || kind.includes('write')) {
    return 'Write';
  }
  return 'Edit';
}

function getFileChangePath(item: any): string {
  const changes = Array.isArray(item?.changes) ? item.changes : [];
  return (
    getStringField(item, ['path', 'filePath', 'file_path']) ||
    getStringField(changes[0], ['path', 'filePath', 'file_path']) ||
    ''
  );
}

function parseDiffToLines(diff: string): string[] {
  if (!diff) return [];
  const result: string[] = [];
  for (const line of diff.split('\n')) {
    // Trailing-space form so a removed/added code line whose content
    // starts with "---"/"+++" (e.g. removing a markdown HR "---" arrives
    // as "----") is not misclassified as a header.
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;
    if (line.startsWith('@@')) continue;
    if (line.startsWith('diff ') || line.startsWith('index ')) continue;
    if (line.startsWith('\\ ')) continue;
    if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) {
      result.push(line);
    }
  }
  return result;
}

function toStructuredPatch(item: any): any[] {
  const changes = Array.isArray(item?.changes) ? item.changes : [];
  return changes.map((change: any) => {
    const diff = typeof change?.diff === 'string' ? change.diff : '';
    return {
      filePath: getStringField(change, ['path', 'filePath', 'file_path']) || getFileChangePath(item),
      kind: change?.kind,
      diff,
      lines: parseDiffToLines(diff),
      status: item?.status
    };
  });
}

function createFileChangePart(item: any): any {
  const toolName = getFileChangeKind(item);
  const filePath = getFileChangePath(item);
  const structuredPatch = toStructuredPatch(item);
  const diffText = structuredPatch
    .map((change) => change.diff)
    .filter(Boolean)
    .join('\n');

  return {
    type: `tool-${toolName}`,
    toolCallId: getAppServerItemId(item),
    toolName,
    state: 'input-available',
    input:
      toolName === 'Write'
        ? {
            file_path: filePath,
            content: diffText
          }
        : {
            file_path: filePath,
            old_string: '',
            new_string: diffText
          },
    output: {
      structuredPatch,
      status: item?.status
    },
    result: {
      structuredPatch,
      status: item?.status
    },
    startedAt: Date.now()
  };
}

function createReasoningPart(item: any): any {
  const toolCallId = getAppServerItemId(item);
  const summary = Array.isArray(item?.summary)
    ? item.summary.join('\n')
    : typeof item?.summary === 'string'
      ? item.summary
      : '';
  const content = Array.isArray(item?.content)
    ? item.content.join('\n')
    : typeof item?.content === 'string'
      ? item.content
      : '';
  const thinking = [summary, content].filter(Boolean).join('\n\n');

  return {
    type: 'tool-Thinking',
    toolCallId,
    toolName: 'Thinking',
    state: thinking ? 'output-available' : 'input-streaming',
    input: {},
    output: thinking ? { thinking } : undefined,
    result: thinking ? { thinking } : undefined,
    thinking,
    startedAt: Date.now()
  };
}

function createMcpToolPart(item: any): any {
  const server = typeof item?.server === 'string' ? item.server : 'mcp';
  const tool = typeof item?.tool === 'string' ? item.tool : 'tool';
  const toolName = `mcp__${server}__${tool.replaceAll('/', '__')}`;
  return {
    type: `tool-${toolName}`,
    toolCallId: getAppServerItemId(item),
    toolName,
    state: 'input-available',
    input: item?.arguments || {},
    startedAt: Date.now()
  };
}

function summarizeCodexServerRequestParams(params: Record<string, unknown>): string {
  const tool = typeof params.tool === 'string' ? params.tool : undefined;
  const server = typeof params.server === 'string' ? params.server : undefined;
  const permissions = isAppServerRecord(params.permissions) ? Object.keys(params.permissions) : [];
  const content = typeof params.content === 'string' ? params.content : undefined;
  const prompt = typeof params.prompt === 'string' ? params.prompt : undefined;

  return [
    server ? `server=${server}` : '',
    tool ? `tool=${tool}` : '',
    permissions.length > 0 ? `permissions=${permissions.join(',')}` : '',
    content ? `content=${JSON.stringify(content.slice(0, 120))}` : '',
    prompt ? `prompt=${JSON.stringify(prompt.slice(0, 120))}` : ''
  ]
    .filter(Boolean)
    .join(' ');
}

function createWebSearchPart(item: any): any {
  const action = item?.action || {};
  const query = typeof item?.query === 'string' ? item.query : typeof action?.query === 'string' ? action.query : '';
  return {
    type: 'tool-WebSearch',
    toolCallId: getAppServerItemId(item),
    toolName: 'WebSearch',
    state: 'input-available',
    input: {
      query,
      action
    },
    startedAt: Date.now()
  };
}

function createPlanWritePartFromPlan(params: { itemId: string; prompt: string; text?: string; plan?: any }): any {
  const planLike = params.plan;
  const normalizedPlan = Array.isArray(planLike)
    ? normalizeCodexPlan({
        id: `plan-${Date.now()}`,
        title: 'Implementation plan',
        summary: params.text,
        status: 'awaiting_approval',
        steps: planLike.map((step: any, index: number) => ({
          title:
            typeof step?.step === 'string'
              ? step.step
              : typeof step?.title === 'string'
                ? step.title
                : `Step ${index + 1}`,
          description: typeof step?.description === 'string' ? step.description : undefined,
          status: step?.status === 'inProgress' ? 'in_progress' : step?.status === 'completed' ? 'completed' : 'pending'
        }))
      })
    : planLike && typeof planLike === 'object' && Array.isArray(planLike.steps)
      ? normalizeCodexPlan(planLike)
      : normalizeCodexPlan({
          id: `plan-${Date.now()}`,
          title: 'Implementation plan',
          summary: params.text,
          status: 'awaiting_approval',
          steps: extractPlanStepTitles(params.text || '').map((title) => ({
            title,
            status: 'pending'
          }))
        });

  const output = {
    success: true,
    message: 'Plan ready for review.',
    action: 'create',
    plan: normalizedPlan
  };

  return {
    type: 'tool-PlanWrite',
    toolCallId: params.itemId,
    toolName: 'PlanWrite',
    state: 'output-available',
    input: {
      action: 'create',
      plan: normalizedPlan
    },
    output,
    result: output,
    startedAt: Date.now()
  };
}

function handleItemStarted(accumulator: AppServerTurnAccumulator, item: any) {
  if (!isAppServerRecord(item)) return;

  const itemType = item.type;
  if (itemType === 'commandExecution') {
    const part = createCommandPart(item);
    emitToolStart(accumulator, part, part.input);
    return;
  }

  if (itemType === 'fileChange') {
    const part = createFileChangePart(item);
    emitToolStart(accumulator, part, part.input);
    return;
  }

  if (itemType === 'reasoning') {
    const part = createReasoningPart(item);
    emitToolStart(accumulator, part, part.input);
    if (part.output) {
      updateToolOutput(accumulator, part.toolCallId, part.output);
    }
    return;
  }

  if (itemType === 'mcpToolCall') {
    const part = createMcpToolPart(item);
    emitToolStart(accumulator, part, part.input);
    return;
  }

  if (itemType === 'webSearch') {
    const part = createWebSearchPart(item);
    emitToolStart(accumulator, part, part.input);
    return;
  }

  if (itemType === 'plan') {
    const text = typeof item.text === 'string' ? item.text : '';
    const itemId = getAppServerItemId(item);
    const part =
      accumulator.mode === 'execute'
        ? createTaskListPartFromPlan({
            itemId,
            text,
            plan: item.plan
          })
        : createPlanWritePartFromPlan({
            itemId,
            prompt: accumulator.prompt,
            text,
            plan: item.plan
          });
    emitToolStart(accumulator, part, part.input);
    updateToolOutput(accumulator, part.toolCallId, part.output);
  }
}

function handleItemCompleted(accumulator: AppServerTurnAccumulator, item: any) {
  if (!isAppServerRecord(item)) return;

  const itemType = item.type;
  const itemId = getAppServerItemId(item);

  if (itemType === 'agentMessage') {
    const text = typeof item.text === 'string' ? item.text : '';
    if (text && !accumulator.currentText.includes(text)) {
      emitTextDelta(accumulator, text);
    }
    flushTextPart(accumulator);
    return;
  }

  if (itemType === 'commandExecution') {
    const part = accumulator.toolPartsByItemId.get(itemId) || createCommandPart(item);
    if (!accumulator.toolPartsByItemId.has(itemId)) {
      emitToolStart(accumulator, part, part.input);
    }
    updateToolOutput(
      accumulator,
      itemId,
      toCommandOutput(item, part.outputText),
      item.status === 'failed' || item.status === 'declined' ? 'output-error' : 'output-available'
    );
    return;
  }

  if (itemType === 'fileChange') {
    const part = accumulator.toolPartsByItemId.get(itemId) || createFileChangePart(item);
    if (!accumulator.toolPartsByItemId.has(itemId)) {
      emitToolStart(accumulator, part, part.input);
    }
    const structuredPatch = toStructuredPatch(item);
    const output = { structuredPatch, status: item.status };
    updateToolOutput(
      accumulator,
      itemId,
      output,
      item.status === 'failed' || item.status === 'declined' ? 'output-error' : 'output-available'
    );
    return;
  }

  if (itemType === 'reasoning') {
    const part = accumulator.toolPartsByItemId.get(itemId) || createReasoningPart(item);
    if (!accumulator.toolPartsByItemId.has(itemId)) {
      emitToolStart(accumulator, part, part.input);
    }
    const finalPart = createReasoningPart(item);
    part.thinking = finalPart.thinking;
    updateToolOutput(accumulator, itemId, { thinking: finalPart.thinking });
    return;
  }

  if (itemType === 'mcpToolCall') {
    const part = accumulator.toolPartsByItemId.get(itemId) || createMcpToolPart(item);
    if (!accumulator.toolPartsByItemId.has(itemId)) {
      emitToolStart(accumulator, part, part.input);
    }
    updateToolOutput(
      accumulator,
      itemId,
      item.error ? { error: item.error } : item.result,
      item.status === 'failed' ? 'output-error' : 'output-available'
    );
    return;
  }

  if (itemType === 'webSearch') {
    const part = accumulator.toolPartsByItemId.get(itemId) || createWebSearchPart(item);
    if (!accumulator.toolPartsByItemId.has(itemId)) {
      emitToolStart(accumulator, part, part.input);
    }
    updateToolOutput(accumulator, itemId, {
      query: part.input?.query,
      action: item.action,
      results: item.results
    });
    return;
  }

  if (itemType === 'plan') {
    const part =
      accumulator.mode === 'execute'
        ? createTaskListPartFromPlan({
            itemId,
            text: typeof item.text === 'string' ? item.text : '',
            plan: item.plan
          })
        : createPlanWritePartFromPlan({
            itemId,
            prompt: accumulator.prompt,
            text: typeof item.text === 'string' ? item.text : '',
            plan: item.plan
          });
    if (!accumulator.toolPartsByItemId.has(itemId)) {
      emitToolStart(accumulator, part, part.input);
    }
    updateToolOutput(accumulator, itemId, part.output);
  }
}

function appendToolText(accumulator: AppServerTurnAccumulator, itemId: string, outputDelta: string) {
  const part = accumulator.toolPartsByItemId.get(itemId);
  if (!part || !outputDelta) return;
  part.outputText = `${part.outputText || ''}${outputDelta}`;
  part.output = toCommandOutput({}, part.outputText);
  part.result = part.output;
  accumulator.safeEmit({
    type: 'tool-output-available',
    toolCallId: itemId,
    output: part.output
  });
}

function handlePlanUpdated(accumulator: AppServerTurnAccumulator, params: any) {
  const plan = params?.plan;
  const itemId =
    getStringField(params, ['itemId', 'item_id']) || `codex-plan-${getAppServerTurnId(params) || crypto.randomUUID()}`;
  const existing = accumulator.toolPartsByItemId.get(itemId);
  const part =
    accumulator.mode === 'execute'
      ? createTaskListPartFromPlan({
          itemId,
          text: typeof params?.explanation === 'string' ? params.explanation : '',
          plan
        })
      : createPlanWritePartFromPlan({
          itemId,
          prompt: accumulator.prompt,
          text: typeof params?.explanation === 'string' ? params.explanation : '',
          plan
        });

  if (!existing) {
    emitToolStart(accumulator, part, part.input);
  } else {
    existing.input = part.input;
    existing.output = part.output;
    existing.result = part.result;
  }
  updateToolOutput(accumulator, itemId, part.output);
}

function handleAppServerNotification(notification: CodexAppServerNotification): void {
  const method = notification.method;
  const params = notification.params;
  const accumulator = getAccumulatorForNotification(notification);

  if (method === 'thread/tokenUsage/updated') {
    const threadId = getAppServerThreadId(params);
    const target = (threadId ? activeAppServerTurns.get(threadId) : null) || accumulator;
    if (target) {
      target.usageMetadata = mapAppServerUsageToMetadata(params, target.model);
    }
    return;
  }

  if (!accumulator) return;
  accumulator.lastEventAt = Date.now();

  if (method === 'turn/started') {
    const turnId = getAppServerTurnId(params);
    const threadId = getAppServerThreadId(params);
    if (turnId && threadId) {
      activeThreadIdsByTurnId.set(turnId, threadId);
      const activeStream = activeStreams.get(accumulator.subChatId);
      if (activeStream) activeStream.turnId = turnId;
    }
    return;
  }

  if (method === 'turn/completed') {
    const turn = isAppServerRecord(params) ? params.turn : null;
    accumulator.completed = true;
    accumulator.stopReason = typeof turn?.status === 'string' ? turn.status : accumulator.stopReason;
    accumulator.resultSubtype = turn?.status === 'failed' ? 'error' : 'success';
    const turnUsage = isAppServerRecord(turn) ? turn.usage : undefined;
    if (turnUsage) {
      accumulator.usageMetadata = mapAppServerUsageToMetadata(turnUsage, accumulator.model);
    }
    return;
  }

  if (method === 'error') {
    const normalized = extractCodexError(params);
    accumulator.safeEmit({ type: 'error', errorText: normalized.message });
    return;
  }

  if (method === 'turn/plan/updated') {
    handlePlanUpdated(accumulator, params);
    return;
  }

  if (!isAppServerRecord(params)) return;

  if (method === 'item/started') {
    handleItemStarted(accumulator, params.item);
    return;
  }

  if (method === 'item/completed') {
    handleItemCompleted(accumulator, params.item);
    return;
  }

  if (method === 'item/agentMessage/delta') {
    emitTextDelta(accumulator, typeof params.delta === 'string' ? params.delta : '');
    return;
  }

  if (method === 'item/plan/delta') {
    handlePlanUpdated(accumulator, {
      ...params,
      explanation: typeof params.delta === 'string' ? params.delta : '',
      plan: [
        {
          step: typeof params.delta === 'string' ? params.delta : 'Update plan',
          status: 'pending'
        }
      ]
    });
    return;
  }

  if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') {
    const itemId = getAppServerItemId(params);
    let part = accumulator.toolPartsByItemId.get(itemId);
    if (!part) {
      part = {
        type: 'tool-Thinking',
        toolCallId: itemId,
        toolName: 'Thinking',
        state: 'input-available',
        input: {},
        thinking: '',
        startedAt: Date.now()
      };
      emitToolStart(accumulator, part, part.input);
    }
    const delta = typeof params.delta === 'string' ? params.delta : '';
    part.thinking = `${part.thinking || ''}${delta}`;
    updateToolOutput(accumulator, itemId, { thinking: part.thinking });
    return;
  }

  if (method === 'item/commandExecution/outputDelta') {
    appendToolText(accumulator, getAppServerItemId(params), typeof params.delta === 'string' ? params.delta : '');
    return;
  }

  if (method === 'item/fileChange/patchUpdated') {
    const itemId = getAppServerItemId(params);
    const item = {
      id: itemId,
      type: 'fileChange',
      status: 'inProgress',
      changes: params.changes || params.patch || []
    };
    let part = accumulator.toolPartsByItemId.get(itemId);
    if (!part) {
      part = createFileChangePart(item);
      emitToolStart(accumulator, part, part.input);
    }
    updateToolOutput(accumulator, itemId, {
      structuredPatch: toStructuredPatch(item),
      status: item.status
    });
  }
}

async function handleAskUserQuestionRequest(params: any) {
  const threadId = getAppServerThreadId(params);
  const subChatId = threadId ? activeStreamsByThreadId.get(threadId) : undefined;
  const accumulator = threadId ? activeAppServerTurns.get(threadId) : undefined;
  const questionsInput = Array.isArray(params?.questions)
    ? params.questions
    : Array.isArray(params?.input?.questions)
      ? params.input.questions
      : [];
  const parsed = z.array(codexQuestionSchema).safeParse(questionsInput);
  const questions = normalizeCodexQuestions(
    parsed.success
      ? parsed.data
      : [
          {
            question:
              typeof params?.question === 'string'
                ? params.question
                : typeof params?.message === 'string'
                  ? params.message
                  : 'How should Codex proceed?',
            header: 'Question',
            options: [
              { label: 'Proceed', description: 'Continue with reasonable defaults.' },
              { label: 'Stop', description: 'Do not continue this turn.' }
            ]
          }
        ]
  );
  const toolUseId =
    getStringField(params, ['callId', 'call_id', 'itemId', 'item_id']) || `AskUserQuestion-${crypto.randomUUID()}`;

  accumulator?.safeEmit({
    type: 'ask-user-question',
    toolUseId,
    questions
  });

  const response = await new Promise<{
    approved: boolean;
    message?: string;
    updatedInput?: unknown;
  }>((resolve) => {
    const timeoutId = setTimeout(() => {
      pendingToolApprovals.delete(toolUseId);
      accumulator?.safeEmit({
        type: 'ask-user-question-timeout',
        toolUseId
      });
      resolve({
        approved: false,
        message: QUESTIONS_TIMED_OUT_MESSAGE
      });
    }, ASK_USER_QUESTION_TIMEOUT_MS);

    pendingToolApprovals.set(toolUseId, {
      subChatId: subChatId || accumulator?.subChatId || '',
      resolve: (decision) => {
        clearTimeout(timeoutId);
        resolve(decision);
      }
    });
  });

  if (!response.approved) {
    const result = response.message || QUESTIONS_SKIPPED_MESSAGE;
    accumulator?.safeEmit({
      type: 'ask-user-question-result',
      toolUseId,
      result
    });
    return {
      contentItems: [{ type: 'inputText', text: result }],
      success: true
    };
  }

  const answers =
    typeof response.updatedInput === 'object' && response.updatedInput !== null && 'answers' in response.updatedInput
      ? (response.updatedInput as { answers?: Record<string, string> }).answers || {}
      : {};
  const result = { answers };
  accumulator?.safeEmit({
    type: 'ask-user-question-result',
    toolUseId,
    result
  });
  return {
    contentItems: [{ type: 'inputText', text: JSON.stringify(result) }],
    success: true
  };
}

async function handleAppServerServerRequest(request: CodexAppServerServerRequest): Promise<unknown> {
  const method = request.method;
  const params = isAppServerRecord(request.params) ? request.params : {};

  if (
    method === 'item/tool/call' &&
    (params.tool === 'AskUserQuestion' || params.tool === 'ask_user_question' || params.tool === 'request_user_input')
  ) {
    return await handleAskUserQuestionRequest(params);
  }

  if (method === 'item/tool/requestUserInput') {
    return await handleAskUserQuestionRequest(params);
  }

  if (method === 'item/permissions/requestApproval') {
    console.log(`[codex app-server] server-request decision=session-permissions method=${method}`);
    return {
      scope: 'session',
      permissions: params.permissions || {}
    };
  }

  const approvalResponse = getCodexAppServerApprovalResponse(
    method as ServerRequest['method'],
    params,
    getSandboxPolicyForAppServerRequest(params)
  );
  if (approvalResponse) {
    const decision = approvalResponse.decision;
    const decisionLabel = typeof decision === 'string' ? decision : JSON.stringify(decision);
    const summary = summarizeCodexServerRequestParams(params);
    const log =
      `[codex app-server] server-request decision=${decisionLabel} method=${method}` + (summary ? ` ${summary}` : '');
    if (decision === 'decline') {
      console.warn(log);
    } else {
      console.log(log);
    }
    return approvalResponse;
  }

  if (method === 'mcpServer/elicitation/request') {
    const summary = summarizeCodexServerRequestParams(params);
    const decision = decideCodexMcpElicitation(params);
    const log =
      `[codex app-server] server-request decision=${decision.action} reason=${decision.reason} method=${method}` +
      (summary ? ` ${summary}` : '');
    if (decision.action === 'accept') {
      console.log(log);
    } else {
      console.warn(log);
    }
    return {
      action: decision.action,
      content: decision.content
    };
  }

  return {};
}

/**
 * Status of the Codex MCP bootstrap, exposed via `getChurroCoderMcpStatus` so the
 * renderer can surface a user-visible toast when registration fails (otherwise the
 * failure is silent and read_plan doesn't work for Codex with no obvious cause).
 *
 * - 'pending'      — bootstrap not yet attempted
 * - 'ready'        — Codex MCP entry registered and pointing at our HTTP server
 * - 'cli-missing'  — Codex CLI not installed; nothing to register (not an error)
 * - 'failed'       — Codex CLI ran but `mcp add` failed (worth a toast)
 */
export type ChurroCoderMcpStatus =
  | { state: 'pending' }
  | { state: 'ready'; serverName: string; url: string }
  | { state: 'cli-missing' }
  | { state: 'failed'; serverName: string; error: string };

let churroCoderMcpStatus: ChurroCoderMcpStatus = { state: 'pending' };
let ensureChurroCoderMcpReadyInFlight: Promise<void> | null = null;

export function getChurroCoderMcpStatus(): ChurroCoderMcpStatus {
  return churroCoderMcpStatus;
}

/**
 * Register the churro-coder MCP server with the Codex CLI.
 * Self-heals: re-runs mcp add if the entry is absent or the URL has drifted.
 *
 * Codex reads the bearer from process.env.CHURRO_MCP_BEARER at session start
 * (referenced by name, not value), so rotating the bearer in churro-mcp.json
 * does not require re-registration — the CLI entry stays valid.
 */
async function bootstrapChurroCoderMcpInternal(): Promise<void> {
  const { url, bearer } = await initMcpHttpServer();
  process.env.CHURRO_MCP_BEARER = bearer;

  const serverName = getAppOwnedChurroCoderMcpServerName();
  let existing: any[] = [];
  try {
    const listResult = await runCodexCli(['mcp', 'list', '--json']);
    if (listResult.exitCode === 0) {
      existing = JSON.parse(listResult.stdout);
    }
  } catch {
    console.warn('[churro-coder] Could not list Codex MCP servers action=cli-missing');
    setChurroCoderMcpStatus({ state: 'cli-missing' }, 'mcp-list-cli-missing');
    return;
  }

  // Clean up legacy/stale app-owned entries. Codex app-server reads global MCP
  // config itself, so a stale churro-coder entry can still be loaded even when
  // this app registered the current dev/prod entry correctly.
  if (Array.isArray(existing)) {
    for (const server of existing) {
      const name = typeof server?.name === 'string' ? server.name : '';
      if (name && shouldRemoveStaleAppOwnedMcpEntry(name, serverName)) {
        await runCodexCli(['mcp', 'remove', name]).catch(() => {});
      }
    }
  }

  const entry = Array.isArray(existing) ? existing.find((s: any) => s.name === serverName) : null;
  const existingUrl = entry?.transport?.url ?? entry?.url ?? null;
  const alreadyRegistered = entry && existingUrl === url;
  const registrationAction = alreadyRegistered ? 'noop' : entry ? 'replace' : 'add';
  console.log(
    `[churro-coder] Codex MCP list result serverName=${serverName} hasEntry=${Boolean(entry)} entryUrl=${existingUrl || 'none'} currentUrl=${url} action=${registrationAction}`
  );

  if (alreadyRegistered) {
    console.log(`[churro-coder] Codex MCP entry "${serverName}" already up-to-date`);
    setChurroCoderMcpStatus({ state: 'ready', serverName, url }, 'already-registered');
    return;
  }

  if (entry) {
    // Remove stale entry (URL drifted — port changed between launches)
    await runCodexCli(['mcp', 'remove', serverName]).catch(() => {});
  }

  try {
    await runCodexCliChecked(['mcp', 'add', serverName, '--url', url, '--bearer-token-env-var', 'CHURRO_MCP_BEARER']);
    clearCodexMcpCache();
    console.log(`[churro-coder] Registered Codex MCP server "${serverName}" at ${url}`);
    setChurroCoderMcpStatus({ state: 'ready', serverName, url }, registrationAction);
  } catch (err) {
    // Most likely cause: bundled Codex CLI doesn't accept --bearer-token-env-var.
    // The plan tracks this as a follow-up (fall back to writing ~/.codex/config.toml).
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      '[churro-coder] Failed to register Codex MCP server. ' +
        'Codex agents will not be able to call read_plan until this is resolved. Error:',
      err
    );
    setChurroCoderMcpStatus({ state: 'failed', serverName, error: errorMessage }, 'bootstrap-failed');
  }
}

export async function ensureChurroCoderMcpReady(params?: { subChatId?: string; force?: boolean }): Promise<void> {
  const endpoint = getMcpHttpEndpoint();
  const status = getChurroCoderMcpStatus();
  const isReadyForCurrentEndpoint =
    status.state === 'ready' && Boolean(endpoint) && endpoint?.url === status.url && Boolean(endpoint?.bearer);

  if (!params?.force && isReadyForCurrentEndpoint) {
    console.log(
      `[churro-coder] MCP bootstrap preflight action=skip subChatId=${params?.subChatId || 'none'} status=${status.state} url=${status.url}`
    );
    return;
  }

  if (ensureChurroCoderMcpReadyInFlight) {
    console.log(
      `[churro-coder] MCP bootstrap preflight action=await-inflight subChatId=${params?.subChatId || 'none'} status=${status.state}`
    );
    return await ensureChurroCoderMcpReadyInFlight;
  }

  console.log(
    `[churro-coder] MCP bootstrap preflight action=bootstrap subChatId=${params?.subChatId || 'none'} status=${status.state} endpointUrl=${endpoint?.url || 'none'} force=${Boolean(params?.force)}`
  );
  ensureChurroCoderMcpReadyInFlight = (async () => {
    try {
      await bootstrapChurroCoderMcpInternal();
    } finally {
      ensureChurroCoderMcpReadyInFlight = null;
    }
  })();
  await ensureChurroCoderMcpReadyInFlight;
}

export async function bootstrapChurroCoderMcp(): Promise<void> {
  try {
    await ensureChurroCoderMcpReady({ force: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[churro-coder] MCP bootstrap startup failure:', error);
    setChurroCoderMcpStatus(
      {
        state: 'failed',
        serverName: getAppOwnedChurroCoderMcpServerName(),
        error: errorMessage
      },
      'startup-exception'
    );
  }
}

export const codexRouter = router({
  getChurroCoderMcpStatus: publicProcedure.query(() => getChurroCoderMcpStatus()),
  getIntegration: publicProcedure.query(async () => {
    const result = await runCodexCli(['login', 'status']);
    const combinedOutput = [result.stdout, result.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join('\n')
      .trim();

    const state = normalizeCodexIntegrationState(combinedOutput);

    return {
      state,
      isConnected: state === 'connected_chatgpt' || state === 'connected_api_key',
      rawOutput: combinedOutput,
      exitCode: result.exitCode
    };
  }),

  logout: publicProcedure.mutation(async () => {
    const logoutResult = await runCodexCli(['logout']);
    const statusResult = await runCodexCli(['login', 'status']);

    const statusOutput = [statusResult.stdout, statusResult.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join('\n')
      .trim();

    const state = normalizeCodexIntegrationState(statusOutput);
    const isConnected = state === 'connected_chatgpt' || state === 'connected_api_key';

    if (isConnected) {
      throw new Error('Failed to log out from Codex. Please try again.');
    }

    const logoutOutput = [logoutResult.stdout, logoutResult.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join('\n')
      .trim();

    return {
      success: true,
      state,
      isConnected: false,
      logoutExitCode: logoutResult.exitCode,
      logoutOutput,
      statusOutput
    };
  }),

  startLogin: publicProcedure.mutation(() => {
    const existingSession = getActiveLoginSession();
    if (existingSession) {
      return toLoginSessionResponse(existingSession);
    }

    const codexCliPath = resolveBundledCodexCliPath();
    const sessionId = crypto.randomUUID();

    const child = spawn(codexCliPath, ['login'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true
    });

    const session: CodexLoginSession = {
      id: sessionId,
      process: child,
      state: 'running',
      output: '',
      url: null,
      error: null,
      exitCode: null
    };

    const handleChunk = (chunk: Buffer | string) => {
      appendLoginOutput(session, chunk.toString('utf8'));
    };

    child.stdout.on('data', handleChunk);
    child.stderr.on('data', handleChunk);

    child.once('error', (error) => {
      session.state = 'error';
      session.error = `[codex] Failed to start login flow: ${error.message}`;
      session.process = null;
    });

    child.once('close', (exitCode) => {
      session.exitCode = exitCode;
      session.process = null;

      if (session.state === 'cancelled') {
        return;
      }

      if (exitCode === 0) {
        session.state = 'success';
        session.error = null;
      } else {
        session.state = 'error';
        session.error = session.error || `Codex login exited with code ${exitCode ?? 'unknown'}`;
      }
    });

    loginSessions.set(sessionId, session);

    return toLoginSessionResponse(session);
  }),

  getLoginSession: publicProcedure
    .input(
      z.object({
        sessionId: z.string()
      })
    )
    .query(({ input }) => {
      const session = loginSessions.get(input.sessionId);
      if (!session) {
        throw new Error('Codex login session not found');
      }

      return toLoginSessionResponse(session);
    }),

  cancelLogin: publicProcedure
    .input(
      z.object({
        sessionId: z.string()
      })
    )
    .mutation(({ input }) => {
      const session = loginSessions.get(input.sessionId);
      if (!session) {
        return { success: true, found: false };
      }

      session.state = 'cancelled';
      session.error = null;

      if (session.process && !session.process.killed) {
        session.process.kill('SIGTERM');
      }

      return { success: true, found: true, session: toLoginSessionResponse(session) };
    }),

  getAllMcpConfig: publicProcedure.query(async () => {
    try {
      return await getAllCodexMcpConfigHandler();
    } catch (error) {
      console.error('[codex.getAllMcpConfig] Error:', error);
      return {
        groups: [],
        error: extractCodexError(error).message
      };
    }
  }),

  refreshMcpConfig: publicProcedure.mutation(() => {
    clearCodexMcpCache();
    return { success: true };
  }),

  addMcpServer: publicProcedure
    .input(
      z.object({
        name: z
          .string()
          .min(1)
          .regex(/^[a-zA-Z0-9_-]+$/, 'Name must contain only letters, numbers, underscores, and hyphens'),
        scope: z.enum(['global', 'project']),
        transport: z.enum(['stdio', 'http']),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        url: z.string().url().optional()
      })
    )
    .mutation(async ({ input }) => {
      if (input.scope !== 'global') {
        throw new Error('Codex MCP currently supports global scope only.');
      }

      const args = ['mcp', 'add', input.name.trim()];
      if (input.transport === 'http') {
        const url = input.url?.trim();
        if (!url) {
          throw new Error('URL is required for HTTP servers.');
        }
        args.push('--url', url);
      } else {
        const command = input.command?.trim();
        if (!command) {
          throw new Error('Command is required for stdio servers.');
        }

        args.push('--', command, ...(input.args || []));
      }

      await runCodexCliChecked(args);
      clearCodexMcpCache();
      return { success: true };
    }),

  removeMcpServer: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        scope: z.enum(['global', 'project']).default('global')
      })
    )
    .mutation(async ({ input }) => {
      if (input.scope !== 'global') {
        throw new Error('Codex MCP currently supports global scope only.');
      }

      await runCodexCliChecked(['mcp', 'remove', input.name.trim()]);
      clearCodexMcpCache();
      return { success: true };
    }),

  startMcpOAuth: publicProcedure
    .input(
      z.object({
        serverName: z.string().min(1),
        projectPath: z.string().optional()
      })
    )
    .mutation(async ({ input }) => {
      try {
        const projectPath = input.projectPath?.trim();
        await runCodexCliChecked(['mcp', 'login', input.serverName.trim()], {
          cwd: projectPath && projectPath.length > 0 ? projectPath : undefined
        });
        clearCodexMcpCache();
        return { success: true as const };
      } catch (error) {
        return {
          success: false as const,
          error: extractCodexError(error).message
        };
      }
    }),

  logoutMcpServer: publicProcedure
    .input(
      z.object({
        serverName: z.string().min(1),
        projectPath: z.string().optional()
      })
    )
    .mutation(async ({ input }) => {
      try {
        const projectPath = input.projectPath?.trim();
        await runCodexCliChecked(['mcp', 'logout', input.serverName.trim()], {
          cwd: projectPath && projectPath.length > 0 ? projectPath : undefined
        });
        clearCodexMcpCache();
        return { success: true as const };
      } catch (error) {
        return {
          success: false as const,
          error: extractCodexError(error).message
        };
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
        mode: z.enum(['plan', 'execute', 'explore']).default('execute'),
        forceNewSession: z.boolean().optional(),
        images: z.array(imageAttachmentSchema).optional(),
        enableTasks: z.boolean().optional(),
        authConfig: z
          .object({
            apiKey: z.string().min(1)
          })
          .optional()
      })
    )
    .subscription(({ input }) => {
      return Sentry.startSpanManual(
        {
          name: 'codex.chat',
          op: 'chat.stream',
          attributes: {
            workspace_id: input.chatId,
            subchat_id: input.subChatId,
            session_id: 'new',
            mode: input.mode
          }
        },
        (span, finishSpan) =>
          observable<any>((emit) => {
            let spanEnded = false;
            let resolvedSessionId = 'new';
            const finishStreamSpan = (reason: string, extra?: Record<string, string>) => {
              if (spanEnded) return;
              spanEnded = true;
              span.setAttribute('stream.result', reason);
              for (const [key, value] of Object.entries(extra ?? {})) {
                span.setAttribute(key, value);
              }
              finishSpan();
            };

            const logAttributes = (extra?: Record<string, string>) => ({
              workspace_id: input.chatId,
              subchat_id: input.subChatId,
              session_id: resolvedSessionId,
              stream_id: input.runId.slice(-8),
              mode: input.mode,
              ...extra
            });

            // If a live stream already exists for this subChatId, do NOT abort it —
            // return an empty observable instead. This makes tab-switching a no-op
            // at the backend level, so in-flight streams survive workspace switches.
            const existingStream = activeStreams.get(input.subChatId);
            if (existingStream && !existingStream.controller.signal.aborted) {
              console.log(`[SD] M:SKIP_DUPLICATE_START sub=${input.subChatId.slice(-8)} reason=already_active`);
              emit.complete();
              finishStreamSpan('duplicate_start');
              return () => {};
            }

            const abortController = new AbortController();
            activeStreams.set(input.subChatId, {
              runId: input.runId,
              controller: abortController,
              cancelRequested: false
            });

            recordChatEvent({
              ts: Date.now(),
              phase: 'dispatch',
              sub: input.subChatId.slice(-8),
              workspace_id: input.chatId,
              mode: input.mode,
              stream_id: input.runId.slice(-8)
            });

            void Sentry.withActiveSpan(span, async () => {
              Sentry.logger.info(`stream start sub=${input.subChatId.slice(-8)}`, logAttributes());
            });

            let isActive = true;
            let emittedFinish = false;

            const safeEmit = (chunk: any) => {
              if (!isActive) return;
              if (chunk?.type === 'finish') emittedFinish = true;
              try {
                emit.next(chunk);
              } catch {
                isActive = false;
              }
            };

            const safeComplete = () => {
              if (!isActive) return;
              isActive = false;
              try {
                emit.complete();
              } catch {
                // Ignore double completion
              }
            };

            void Sentry.withActiveSpan(span, async () => {
              try {
                const db = getDatabase();

                const existingSubChat = db.select().from(subChats).where(eq(subChats.id, input.subChatId)).get();

                if (!existingSubChat) {
                  throw new Error('Sub-chat not found');
                }

                persistSubChatRunMode({
                  db,
                  subChatId: input.subChatId,
                  existingMode: existingSubChat.mode,
                  inputMode: input.mode
                });

                const existingMessages = parseStoredMessages(existingSubChat.messages);
                const requestedModelId = extractCodexModelId(input.model) || DEFAULT_CODEX_MODEL;
                const selectedModelId = preprocessCodexModelName({
                  modelId: requestedModelId,
                  authConfig: input.authConfig
                });
                const metadataModel = selectedModelId;

                const lastMessage = existingMessages[existingMessages.length - 1];
                const isDuplicatePrompt =
                  lastMessage?.role === 'user' && extractPromptFromStoredMessage(lastMessage) === input.prompt;

                let messagesForStream = existingMessages;
                const isAuthoritativeRun = () => {
                  const currentStream = activeStreams.get(input.subChatId);
                  return !currentStream || currentStream.runId === input.runId;
                };

                const persistSubChatMessages = (messages: any[]) => {
                  if (!isAuthoritativeRun()) {
                    return false;
                  }

                  const json = JSON.stringify(messages);
                  db.update(subChats)
                    .set({
                      messages: json,
                      ...computeFileStatsFromMessages(json),
                      updatedAt: new Date()
                    })
                    .where(eq(subChats.id, input.subChatId))
                    .run();
                  return true;
                };

                const cleanAssistantMessageForPersistence = (message: any) => {
                  if (!message || message.role !== 'assistant') return message;
                  if (!Array.isArray(message.parts)) return message;

                  const cleanedParts = message.parts.filter((part: any) => part?.state !== 'input-streaming');

                  if (cleanedParts.length === 0) {
                    return null;
                  }

                  const cleanedMessage = {
                    ...message,
                    parts: cleanedParts
                  };

                  return normalizeCodexAssistantMessage(cleanedMessage, {
                    normalizeState: true
                  });
                };

                if (!isDuplicatePrompt) {
                  const userMessage = {
                    id: crypto.randomUUID(),
                    role: 'user',
                    parts: buildUserParts(input.prompt, input.images),
                    metadata: { model: metadataModel }
                  };

                  messagesForStream = [...existingMessages, userMessage];

                  {
                    const messagesForStreamJson = JSON.stringify(messagesForStream);
                    db.update(subChats)
                      .set({
                        messages: messagesForStreamJson,
                        ...computeFileStatsFromMessages(messagesForStreamJson),
                        updatedAt: new Date()
                      })
                      .where(eq(subChats.id, input.subChatId))
                      .run();
                  }
                }

                if (input.forceNewSession) {
                  cleanupCodexAppServerSubChat(input.subChatId);
                }

                let mcpSnapshot: CodexMcpSnapshot = {
                  mcpServersForSession: [],
                  groups: [],
                  fingerprint: getCodexMcpFingerprint([]),
                  fetchedAt: Date.now(),
                  toolsResolved: false
                };
                const approvedPlanRequired = input.mode === 'execute' && (await hasPlan(input.subChatId));
                try {
                  await ensureChurroCoderMcpReady({ subChatId: input.subChatId });
                } catch (mcpBootstrapError) {
                  console.error(
                    `[churro-coder] MCP bootstrap preflight failed subChatId=${input.subChatId}:`,
                    mcpBootstrapError
                  );
                }
                const mcpStatus = getChurroCoderMcpStatus();
                const mcpServerName =
                  mcpStatus.state === 'ready' || mcpStatus.state === 'failed'
                    ? mcpStatus.serverName
                    : getAppOwnedChurroCoderMcpServerName();
                if (approvedPlanRequired && mcpStatus.state !== 'ready') {
                  const mcpToolName = getAppOwnedChurroCoderReadPlanToolName(mcpServerName);
                  const message = buildApprovedPlanReadPlanUnavailableMessage({
                    mcpToolName,
                    status: mcpStatus
                  });
                  throw new Error(message);
                }
                try {
                  const resolvedProjectPathFromCwd = resolveProjectPathFromWorktree(input.cwd);
                  const mcpLookupPath = input.projectPath || resolvedProjectPathFromCwd || input.cwd;
                  mcpSnapshot = await resolveCodexMcpSnapshot({
                    lookupPath: mcpLookupPath
                  });
                } catch (mcpError) {
                  console.error('[codex] Failed to resolve MCP servers:', mcpError);
                }

                const startedAt = Date.now();
                const catchup = computeCatchupBlock(messagesForStream, 'codex');
                const planInstruction = buildCodexModeInstruction(input.mode);
                const subChatPlanHint = approvedPlanRequired
                  ? buildCodexApprovedPlanHint(input.subChatId, getAppOwnedChurroCoderReadPlanToolName(mcpServerName))
                  : '';
                const augmentedPrompt = [planInstruction, subChatPlanHint, catchup, input.prompt]
                  .filter((segment): segment is string => Boolean(segment))
                  .join('\n\n');

                let planWriteFallbackPart: any | null = null;
                let planWriteFallbackEmitted = false;
                let suppressPlanWriteFallback = false;
                const planStreamAccumulator = input.mode === 'plan' ? createCodexPlanStreamAccumulator() : null;

                const emitPlanWriteFallbackIfNeeded = () => {
                  if (
                    input.mode !== 'plan' ||
                    !planStreamAccumulator ||
                    planWriteFallbackEmitted ||
                    suppressPlanWriteFallback
                  ) {
                    return;
                  }

                  flushCodexPlanText(planStreamAccumulator);
                  const messagesWithPlanFallback = ensurePlanWriteForCodexPlanMode({
                    messages: [
                      {
                        id: 'codex-plan-stream-accumulator',
                        role: 'assistant',
                        parts: planStreamAccumulator.parts
                      }
                    ],
                    prompt: input.prompt,
                    fallbackPart: planWriteFallbackPart
                  });

                  planWriteFallbackPart = messagesWithPlanFallback.fallbackPart;
                  if (!planWriteFallbackPart) return;

                  planWriteFallbackEmitted = true;
                  safeEmit({
                    type: 'tool-input-start',
                    toolCallId: planWriteFallbackPart.toolCallId,
                    toolName: 'PlanWrite',
                    providerMetadata: {
                      custom: {
                        startedAt: planWriteFallbackPart.startedAt,
                        synthesized: true
                      }
                    }
                  });
                  safeEmit({
                    type: 'tool-input-available',
                    toolCallId: planWriteFallbackPart.toolCallId,
                    toolName: 'PlanWrite',
                    input: planWriteFallbackPart.input,
                    providerMetadata: {
                      custom: {
                        startedAt: planWriteFallbackPart.startedAt,
                        synthesized: true
                      }
                    }
                  });
                  safeEmit({
                    type: 'tool-output-available',
                    toolCallId: planWriteFallbackPart.toolCallId,
                    output: planWriteFallbackPart.output
                  });
                };

                const safeEmitTurn = (chunk: any) => {
                  if (chunk?.type === 'error' || chunk?.type === 'auth-error') {
                    suppressPlanWriteFallback = true;
                  }
                  if (planStreamAccumulator) {
                    accumulateCodexPlanStreamChunk(planStreamAccumulator, chunk);
                  }
                  safeEmit(chunk);
                };

                const beforeSnapshot = await captureGitChangeSnapshot(input.cwd).catch((error) => {
                  console.warn('[codex] Failed to capture pre-turn git snapshot:', error);
                  return new Map<string, GitChangeSnapshotEntry>();
                });

                const hasAppManagedApiKey = Boolean(input.authConfig?.apiKey?.trim());
                const persistedThreadId =
                  subChatThreadIds.get(input.subChatId) ||
                  (!hasAppManagedApiKey ? getLastSessionId(existingMessages) : undefined);

                const mcpServersForUi = mcpSnapshot.groups.flatMap((group) =>
                  group.mcpServers.map((server) => ({
                    name: server.name,
                    status: server.status,
                    ...(typeof server.config?.serverInfo === 'object' ? { serverInfo: server.config.serverInfo } : {}),
                    ...(typeof server.config?.error === 'string' ? { error: server.config.error } : {})
                  }))
                );
                const mcpTools = mcpSnapshot.groups
                  .flatMap((group) => group.mcpServers)
                  .flatMap((server) =>
                    server.tools.map((tool) => `mcp__${server.name}__${tool.name.replaceAll('/', '__')}`)
                  );
                const builtInTools =
                  input.mode === 'plan'
                    ? [
                        'Bash',
                        'Read',
                        'Glob',
                        'Grep',
                        'Thinking',
                        'WebSearch',
                        'WebFetch',
                        'PlanWrite',
                        'AskUserQuestion'
                      ]
                    : input.mode === 'explore'
                      ? ['Bash', 'Read', 'Glob', 'Grep', 'Thinking', 'WebSearch', 'WebFetch', 'AskUserQuestion']
                      : [
                          'Bash',
                          'Edit',
                          'Write',
                          'Read',
                          'Glob',
                          'Grep',
                          'Thinking',
                          'WebSearch',
                          'WebFetch',
                          'TaskCreate',
                          'TaskUpdate',
                          'TaskGet',
                          'TaskList',
                          'AskUserQuestion'
                        ];

                const codexSandboxPolicy = await resolveSandboxPolicy(
                  input.chatId,
                  input.cwd,
                  input.projectPath ?? input.cwd
                );

                const turnAccumulator: AppServerTurnAccumulator = {
                  subChatId: input.subChatId,
                  prompt: input.prompt,
                  model: metadataModel,
                  mode: input.mode,
                  startedAt,
                  safeEmit: safeEmitTurn,
                  parts: [],
                  currentTextId: null,
                  currentText: '',
                  toolPartsByItemId: new Map(),
                  usageMetadata: null,
                  completed: false,
                  lastEventAt: Date.now()
                };

                const onAbort = () => {
                  const stream = activeStreams.get(input.subChatId);
                  if (stream?.runId === input.runId) {
                    void interruptCodexTurn(stream);
                  }
                };
                let abortListenerAttached = false;
                let didEmitSessionInit = false;
                let resolvedThreadId: string | undefined;

                // Inner attempt: tries the full lifecycle (spawn / resume / turn / wait)
                // exactly once. Throws on any failure so the surrounding retry loop can
                // classify it and decide whether to restart and try again.
                const runChatAttempt = async (): Promise<void> => {
                  const appServerSession = await getOrCreateAppServerSession({
                    authConfig: input.authConfig
                  });
                  const client = appServerSession.client;
                  const sessionKey = getAppServerSessionKey(input.authConfig);
                  const activeStream = activeStreams.get(input.subChatId);
                  if (activeStream?.runId === input.runId) {
                    activeStream.client = client;
                    activeStream.sandboxPolicy = buildCodexSandboxPolicy(
                      input.mode,
                      codexSandboxPolicy.enabled,
                      codexSandboxPolicy.writableRootsExpanded.filter((r) => r !== input.cwd)
                    );
                  }

                  const candidateThreadId = input.forceNewSession ? undefined : resolvedThreadId || persistedThreadId;

                  let threadId: string;
                  try {
                    threadId = await startOrResumeAppServerThread({
                      client,
                      threadId: candidateThreadId,
                      cwd: input.cwd,
                      selectedModelId
                    });
                  } catch (resumeError) {
                    if (!candidateThreadId || input.forceNewSession) {
                      throw resumeError;
                    }
                    console.info('[codex] App-server thread not resumable, starting fresh:', resumeError);
                    threadId = await startOrResumeAppServerThread({
                      client,
                      cwd: input.cwd,
                      selectedModelId
                    });
                  }

                  resolvedThreadId = threadId;
                  trackCodexThreadSubscription(
                    {
                      subChatThreadIds,
                      subChatSessionKeys,
                      activeStreamsByThreadId,
                      activeAppServerTurns,
                      activeThreadIdsByTurnId
                    },
                    {
                      subChatId: input.subChatId,
                      threadId,
                      sessionKey
                    }
                  );
                  const streamForThread = activeStreams.get(input.subChatId);
                  if (streamForThread?.runId === input.runId) {
                    streamForThread.threadId = threadId;
                  }
                  resolvedSessionId = threadId;
                  span.setAttribute('session_id', threadId);

                  if (!didEmitSessionInit) {
                    recordChatEvent({
                      ts: Date.now(),
                      phase: 'session-resolved',
                      sub: input.subChatId.slice(-8),
                      workspace_id: input.chatId,
                      mode: input.mode,
                      session_id: threadId,
                      stream_id: input.runId.slice(-8)
                    });
                    Sentry.logger.info(
                      `stream session resolved sub=${input.subChatId.slice(-8)}`,
                      logAttributes({ session_id: threadId })
                    );
                    safeEmit({
                      type: 'session-init',
                      tools: [...builtInTools, ...mcpTools],
                      mcpServers: mcpServersForUi,
                      plugins: [],
                      skills: []
                    });
                    safeEmit({ type: 'start' });
                    safeEmit({ type: 'start-step' });
                    didEmitSessionInit = true;
                  }

                  // Reset per-attempt accumulator timing fields so the idle-timeout
                  // doesn't fire immediately based on the previous attempt's clock.
                  turnAccumulator.completed = false;
                  turnAccumulator.lastEventAt = Date.now();
                  activeAppServerTurns.set(threadId, turnAccumulator);

                  if (!abortListenerAttached) {
                    abortController.signal.addEventListener('abort', onAbort, { once: true });
                    abortListenerAttached = true;
                  }

                  const turnResult = await client.request(
                    'turn/start',
                    {
                      threadId,
                      input: buildAppServerInput(augmentedPrompt, input.images),
                      ...buildCodexTurnConfig({
                        cwd: input.cwd,
                        mode: input.mode,
                        selectedModelId,
                        sandboxEnabled: codexSandboxPolicy.enabled,
                        // Pass the symlink-expanded set so the OS sandbox accepts
                        // both forms of paths like macOS /tmp <-> /private/tmp.
                        writableRoots: codexSandboxPolicy.writableRootsExpanded.filter((r) => r !== input.cwd)
                      })
                    },
                    30_000
                  );
                  const turnId = extractTurnIdFromStartResult(turnResult);
                  if (turnId) {
                    activeThreadIdsByTurnId.set(turnId, threadId);
                    const stream = activeStreams.get(input.subChatId);
                    if (stream?.runId === input.runId) {
                      stream.turnId = turnId;
                    }
                  }

                  await waitForAppServerTurn({
                    accumulator: turnAccumulator,
                    getTransportLastActivityAt: () => appServerSession.lastActivityAt,
                    signal: abortController.signal,
                    idleTimeoutMs: 60_000,
                    maxRuntimeMs: 60 * 60 * 1000
                  });
                  if (!turnAccumulator.usageMetadata && !abortController.signal.aborted) {
                    await new Promise((resolve) => setTimeout(resolve, 750));
                  }
                };

                // Retry loop: classify each failure and either retry transparently
                // (emitting a `retry-notification` chunk so the renderer keeps the
                // stream in `streaming` state and never shows the Continue button),
                // or rethrow so the outer catch surfaces the user-facing error.
                let attempts = 0;
                while (true) {
                  try {
                    await runChatAttempt();
                    break;
                  } catch (error) {
                    attempts += 1;
                    const observedSideEffects =
                      turnAccumulator.parts.length > 0 || turnAccumulator.usageMetadata !== null;
                    const aborted = abortController.signal.aborted;
                    const classification: CodexFailureClassification = classifyCodexFailure(error, {
                      observedSideEffects,
                      attempt: attempts,
                      aborted
                    });

                    console.log(
                      `[codex] retry attempt=${attempts}/${CODEX_MAX_ATTEMPTS} ` +
                        `category=${classification.category} retry=${classification.retry} ` +
                        `forceRestart=${classification.forceRestart} ` +
                        `sideEffects=${observedSideEffects} ` +
                        `sub=${input.subChatId.slice(-8)}`
                    );
                    Sentry.logger.info(
                      `stream attempt failed sub=${input.subChatId.slice(-8)}`,
                      logAttributes({
                        attempt: String(attempts),
                        category: classification.category,
                        will_retry: String(classification.retry),
                        force_restart: String(classification.forceRestart)
                      })
                    );

                    if (!classification.retry) {
                      throw error;
                    }

                    safeEmit({
                      type: 'retry-notification',
                      message: classification.userMessage
                    });

                    const shouldForceRestart =
                      classification.forceRestart ||
                      attempts >= CODEX_FORCE_RESTART_AFTER ||
                      error instanceof CodexAppServerClosedError;
                    if (shouldForceRestart) {
                      disposeAppServerSessionForAuth(
                        input.authConfig,
                        `recovery-${classification.category}`,
                        input.subChatId
                      );
                    }

                    await delayWithAbort(getCodexRetryDelay(attempts - 1), abortController.signal);
                    if (abortController.signal.aborted) {
                      throw error;
                    }
                  }
                }

                if (abortListenerAttached) {
                  abortController.signal.removeEventListener('abort', onAbort);
                }

                if (!resolvedThreadId) {
                  throw new Error('Codex chat completed without resolving a thread id');
                }
                const threadId = resolvedThreadId;

                flushTextPart(turnAccumulator);

                if (input.mode === 'plan') {
                  emitPlanWriteFallbackIfNeeded();
                }

                const afterSnapshot = await captureGitChangeSnapshot(input.cwd).catch((error) => {
                  console.warn('[codex] Failed to capture post-turn git snapshot:', error);
                  return new Map<string, GitChangeSnapshotEntry>();
                });
                const changedFiles = diffGitChangeSnapshots(beforeSnapshot, afterSnapshot);
                const finalMetadata = {
                  model: metadataModel,
                  thinking: splitCodexModelAndEffort(metadataModel).effort,
                  sessionId: threadId,
                  durationMs: Date.now() - startedAt,
                  resultSubtype:
                    turnAccumulator.resultSubtype || (abortController.signal.aborted ? 'interrupted' : 'success'),
                  stopReason: turnAccumulator.stopReason || (abortController.signal.aborted ? 'interrupted' : 'stop'),
                  ...(turnAccumulator.usageMetadata || {}),
                  ...(changedFiles.length > 0 ? { changedFiles } : {})
                };

                try {
                  const assistantMessage = {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    parts: turnAccumulator.parts,
                    metadata: finalMetadata
                  };
                  const shouldPersistAssistant =
                    assistantMessage.parts.length > 0 ||
                    changedFiles.length > 0 ||
                    Boolean(turnAccumulator.usageMetadata);
                  const messagesWithAssistant = shouldPersistAssistant
                    ? [...messagesForStream, assistantMessage]
                    : messagesForStream;
                  const messagesWithPlanFallback =
                    input.mode === 'plan'
                      ? ensurePlanWriteForCodexPlanMode({
                          messages: messagesWithAssistant,
                          prompt: input.prompt,
                          fallbackPart: planWriteFallbackPart
                        })
                      : { messages: messagesWithAssistant, fallbackPart: null };
                  planWriteFallbackPart = messagesWithPlanFallback.fallbackPart;

                  // Persist plan to disk for cross-provider retrieval via churro-coder MCP
                  if (input.mode === 'plan') {
                    const lastAssistant = [...messagesWithPlanFallback.messages]
                      .reverse()
                      .find((m: any) => m.role === 'assistant');
                    if (lastAssistant) {
                      const planObj = findPlanFromAnyPlanWritePart(lastAssistant);
                      const planContent = planObj ? formatStructuredPlanAsMarkdown(planObj) : null;
                      if (planContent) {
                        void writeCurrentPlan({
                          subChatId: input.subChatId,
                          content: planContent,
                          source: 'codex:PlanWrite',
                          title: typeof planObj?.title === 'string' ? planObj.title : 'Plan'
                        }).catch((err: unknown) => console.error('[churro-coder] Failed to persist codex plan:', err));
                      }
                    }
                  }

                  const cleanedMessages = messagesWithPlanFallback.messages
                    .map(cleanAssistantMessageForPersistence)
                    .filter(Boolean);

                  if (cleanedMessages.length > 0) {
                    persistSubChatMessages(cleanedMessages);
                  } else {
                    persistSubChatMessages(messagesForStream);
                  }
                } catch (persistError) {
                  console.error('[codex] Failed to persist messages:', persistError);
                }

                if (turnAccumulator.usageMetadata || changedFiles.length > 0) {
                  safeEmit({
                    type: 'message-metadata',
                    messageMetadata: finalMetadata
                  });
                }
                safeEmit({ type: 'finish', messageMetadata: finalMetadata });

                safeComplete();
                recordChatEvent({
                  ts: Date.now(),
                  phase: 'end',
                  sub: input.subChatId.slice(-8),
                  workspace_id: input.chatId,
                  mode: input.mode,
                  session_id: threadId,
                  stream_id: input.runId.slice(-8),
                  note: 'ok'
                });
                Sentry.logger.info(
                  `stream end sub=${input.subChatId.slice(-8)}`,
                  logAttributes({ session_id: threadId, reason: 'ok' })
                );
                finishStreamSpan('ok', { session_id: threadId });
              } catch (error) {
                // If the user cancelled mid-retry (or any time before the
                // success path took over) the original transient error gets
                // rethrown — but surfacing it as an `error` chunk would show
                // the user a confusing "stream idle for 60s" toast for what
                // was really a clean cancel. Treat any aborted exit as a
                // benign cancel: emit `finish` only, no error chunk.
                if (abortController.signal.aborted) {
                  console.log(`[codex] stream cancelled sub=${input.subChatId.slice(-8)} (abort during retry)`);
                  Sentry.logger.info(
                    `stream cancelled sub=${input.subChatId.slice(-8)}`,
                    logAttributes({ reason: 'aborted' })
                  );
                  safeEmit({ type: 'finish' });
                  safeComplete();
                  finishStreamSpan('cancelled');
                  return;
                }

                const normalized = extractCodexError(error);

                console.error('[codex] chat stream error:', error);
                recordChatEvent({
                  ts: Date.now(),
                  phase: 'error',
                  sub: input.subChatId.slice(-8),
                  workspace_id: input.chatId,
                  mode: input.mode,
                  stream_id: input.runId.slice(-8),
                  note: normalized.message
                });
                Sentry.logger.info(
                  `stream error sub=${input.subChatId.slice(-8)}`,
                  logAttributes({ reason: normalized.message })
                );
                if (isCodexAuthError(normalized)) {
                  safeEmit({ type: 'auth-error', errorText: normalized.message });
                } else {
                  safeEmit({ type: 'error', errorText: normalized.message });
                }
                safeEmit({ type: 'finish' });
                safeComplete();
                finishStreamSpan('error');
              } finally {
                const activeStream = activeStreams.get(input.subChatId);
                if (activeStream?.runId === input.runId) {
                  if (activeStream.turnId) {
                    activeThreadIdsByTurnId.delete(activeStream.turnId);
                  }
                  if (activeStream.threadId) {
                    activeStreamsByThreadId.delete(activeStream.threadId);
                    activeAppServerTurns.delete(activeStream.threadId);
                  }
                  activeStreams.delete(input.subChatId);
                }
              }
            });

            return () => {
              // If the stream never emitted a finish chunk (e.g. app-server
              // process or turn wait hung), emit one synthetically so the
              // renderer's chatStatus transitions to "ready" and the UI stops
              // showing tools as "Running" forever. Must precede isActive=false
              // because safeEmit no-ops once isActive is cleared.
              if (!emittedFinish) {
                console.log(`[codex] CLEANUP_SYNTHETIC_FINISH sub=${input.subChatId}`);
                safeEmit({ type: 'finish' });
              }
              isActive = false;
              const shouldRecordAbort = !spanEnded;
              abortController.abort();
              if (shouldRecordAbort) {
                recordChatEvent({
                  ts: Date.now(),
                  phase: 'abort',
                  sub: input.subChatId.slice(-8),
                  workspace_id: input.chatId,
                  mode: input.mode,
                  stream_id: input.runId.slice(-8)
                });
                Sentry.logger.info(`stream abort sub=${input.subChatId.slice(-8)}`, logAttributes({ reason: 'abort' }));
                finishStreamSpan('abort');
              }
              clearPendingApprovals('Session ended.', input.subChatId);

              const activeStream = activeStreams.get(input.subChatId);
              if (activeStream?.runId === input.runId) {
                activeStream.cancelRequested = true;
              }
            };
          })
      );
    }),

  cancel: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        runId: z.string()
      })
    )
    .mutation(async ({ input }) => {
      const activeStream = activeStreams.get(input.subChatId);
      if (!activeStream) {
        return { cancelled: false, ignoredStale: false };
      }

      if (activeStream.runId !== input.runId) {
        return { cancelled: false, ignoredStale: true };
      }

      activeStream.cancelRequested = true;
      activeStream.controller.abort();
      await interruptCodexTurn(activeStream);
      clearPendingApprovals('Session cancelled.', input.subChatId);

      return { cancelled: true, ignoredStale: false };
    }),

  cleanup: publicProcedure
    .input(z.object({ subChatId: z.string(), runId: z.string().optional() }))
    .mutation(({ input }) => {
      cleanupCodexAppServerSubChat(input.subChatId);

      const activeStream = activeStreams.get(input.subChatId);
      if (activeStream) {
        // Guard against stale cleanup calls aborting a newer stream (e.g. the plan turn's
        // cleanup() arriving after the implement-plan subscription has already started).
        // When a runId is provided, only abort if it matches the current active stream.
        const shouldAbort = !input.runId || activeStream.runId === input.runId;
        if (shouldAbort) {
          activeStream.controller.abort();
          activeStreams.delete(input.subChatId);
        }
      }
      clearPendingApprovals('Session ended.', input.subChatId);

      return { success: true };
    })
});
