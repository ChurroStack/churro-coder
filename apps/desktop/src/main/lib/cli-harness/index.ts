import { app } from 'electron';
import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { updateClaudeConfigAtomic } from '../claude-config';
import { ensureMcpHttpServerAlive } from '../mcp/http-transport';
import type { TerminalBootstrap } from '../terminal/types';

const execFileAsync = promisify(execFile);

export type CliHarness = 'claude-cli' | 'codex-cli';

export type BootstrapError =
  | { kind: 'binary-missing'; binary: string; hint: string; message: string }
  | { kind: 'mcp-unavailable'; message: string }
  | { kind: 'config-write-failed'; message: string };

export function isBootstrapError(v: unknown): v is BootstrapError {
  return typeof v === 'object' && v !== null && 'kind' in v;
}

const binaryCache = new Map<string, string | null>();

function bundledBinaryPath(name: 'claude' | 'codex'): string | null {
  const binName = process.platform === 'win32' ? `${name}.exe` : name;
  const dir = app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : join(app.getAppPath(), 'resources', 'bin', `${process.platform}-${process.arch}`);
  const p = join(dir, binName);
  return existsSync(p) ? p : null;
}

async function pathLookup(name: string): Promise<string | null> {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execFileAsync(cmd, [name], { timeout: 5_000 });
    const candidate = stdout.trim().split('\n')[0].trim();
    if (!candidate) return null;
    await access(candidate, fsConstants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

async function versionProbe(binaryPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binaryPath, ['--version'], { timeout: 5_000 });
    return stdout.trim().split('\n')[0].trim();
  } catch {
    return null;
  }
}

async function resolveBinary(name: 'claude' | 'codex'): Promise<string | null> {
  if (binaryCache.has(name)) return binaryCache.get(name)!;
  const bundled = bundledBinaryPath(name);
  if (bundled) {
    const version = await versionProbe(bundled);
    console.log(
      `[harness-bootstrap] binary resolved binary=${name} path=${bundled} version=${version ?? 'unknown'} source=bundled`
    );
    binaryCache.set(name, bundled);
    return bundled;
  }
  const onPath = await pathLookup(name);
  if (onPath) {
    const version = await versionProbe(onPath);
    console.log(
      `[harness-bootstrap] binary resolved binary=${name} path=${onPath} version=${version ?? 'unknown'} source=PATH`
    );
  } else {
    console.warn(`[harness-bootstrap] binary not found binary=${name}`);
  }
  binaryCache.set(name, onPath);
  return onPath;
}

export function invalidateBinaryCache(): void {
  binaryCache.clear();
}

async function ensureMcpEndpoint(): Promise<{ url: string; bearer: string }> {
  // Every CLI spawn (initial, restart, hard-reset) must hand the new process
  // a URL that's *actually* reachable. ensureMcpHttpServerAlive pings the
  // cached server and force-restarts it if dead — so a server killed during
  // OS sleep/wake or by a sandbox without our close/error handler firing
  // can't poison the next bootstrap with a stale port.
  return ensureMcpHttpServerAlive();
}

async function injectClaudeCliMcp(subChatId: string, mcpUrl: string, bearer: string): Promise<void> {
  await updateClaudeConfigAtomic((config) => {
    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers[`churro-coder-${subChatId}`] = {
      type: 'http',
      url: mcpUrl,
      headers: { Authorization: `Bearer ${bearer}` }
    };
    return config;
  });
  console.log(`[harness-bootstrap] claude-cli MCP config written sub=${subChatId} url=${mcpUrl}`);
}

export async function removeClaudeCliMcp(subChatId: string): Promise<void> {
  const key = `churro-coder-${subChatId}`;
  await updateClaudeConfigAtomic((config) => {
    if (config.mcpServers?.[key]) {
      delete config.mcpServers[key];
      console.log(`[harness-bootstrap] claude-cli MCP config removed sub=${subChatId}`);
    }
    return config;
  });
}

export async function buildBootstrap(
  harness: CliHarness,
  subChatId: string,
  cwd?: string
): Promise<TerminalBootstrap | BootstrapError> {
  const binaryName = harness === 'claude-cli' ? 'claude' : 'codex';
  console.log(`[harness-bootstrap] start harness=${harness} sub=${subChatId} cwd=${cwd ?? '(none)'}`);

  const binaryPath = await resolveBinary(binaryName);
  if (!binaryPath) {
    const hint =
      harness === 'claude-cli'
        ? 'Install with: npm install -g @anthropic-ai/claude-code'
        : 'Install with: npm install -g @openai/codex';
    console.warn(`[harness-bootstrap] binary-missing harness=${harness} sub=${subChatId} binary=${binaryName}`);
    return { kind: 'binary-missing', binary: binaryName, hint, message: `"${binaryName}" was not found. ${hint}` };
  }

  let endpoint: { url: string; bearer: string };
  try {
    endpoint = await ensureMcpEndpoint();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[harness-bootstrap] mcp-unavailable harness=${harness} sub=${subChatId} error=${message}`);
    return { kind: 'mcp-unavailable', message: `MCP HTTP server unavailable: ${message}` };
  }

  const mcpUrl = `${endpoint.url}sub/${subChatId}/`;
  const args: string[] = [];

  if (harness === 'claude-cli') {
    try {
      await injectClaudeCliMcp(subChatId, mcpUrl, endpoint.bearer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[harness-bootstrap] config-write-failed harness=${harness} sub=${subChatId} error=${message}`);
      return { kind: 'config-write-failed', message: `Failed to write Claude CLI MCP config: ${message}` };
    }
    // Skip the interactive folder-trust dialog — the user explicitly launched
    // this CLI session in their own project, so trust is implicit.
    args.push('--dangerously-skip-permissions');
    // Pre-authorize MCP tools so Claude never prompts for permission on write_plan
    // or write_review. The server name includes the subChatId so we build the exact
    // tool IDs that Claude Code registers for this session.
    const mcpServerName = `churro-coder-${subChatId}`;
    args.push(
      '--allowedTools',
      `mcp__${mcpServerName}__write_plan,mcp__${mcpServerName}__write_review,mcp__${mcpServerName}__write_tasks,mcp__${mcpServerName}__update_task_status,mcp__${mcpServerName}__notify_files_changed,mcp__${mcpServerName}__request_user_input`
    );
    // Instruct Claude to persist plans, reviews, and task progress via MCP so
    // the host app can surface them in the UI without a manual refresh.
    // Wording is intentionally terse and imperative — verbose rule blocks are
    // ignored; this phrasing was validated to reliably trigger tool calls.
    args.push(
      '--append-system-prompt',
      [
        'MCP persistence is mandatory in this session:',
        '- When in plan mode, you MUST call the write_plan tool with the full plan markdown before calling ExitPlanMode or presenting any approval options to the user. Do not call ExitPlanMode until write_plan has succeeded in the same turn.',
        '- When producing a code review, you MUST call the write_review tool with the full review markdown before sending your final assistant message.',
        '- When implementing a plan, you MUST call write_tasks once at the start with all plan steps (each task needs a stable short id, a title, and status: "pending"). Before starting each task call update_task_status with status: "in_progress"; after finishing call it with status: "completed". If the task structure changes, call write_tasks again with the full updated list.',
        '- After every successful file create, edit, or delete (or a batch of them in one turn), you MUST call notify_files_changed with the affected paths and actions. Batch all files from a single turn into one call. This is how the host app tracks changes in the Changes widget.',
        '- When you need to ask the user a clarifying question or get a decision, you MUST call the request_user_input MCP tool with 1-4 structured questions. The host renders the questions as a UI widget above the CLI prompt; do NOT type a question into the terminal and wait for stdin — the user will not see it.',
        '- These tools are pre-authorized; calling them does not require user approval. Skipping them leaves the user UI blank, which is a failure.'
      ].join('\n')
    );
    console.log(`[harness-bootstrap] append-system-prompt injected sub=${subChatId} arg-count=${args.length}`);
  } else {
    // Codex CLI injects MCP via -c config overrides; bearer goes through an env var
    // to avoid exposing it on the process command line. The right-hand side of
    // each -c override is parsed by Codex as a TOML value, so string values must
    // include surrounding double quotes — they are TOML string delimiters, not
    // shell quoting. Args go through execve, not a shell, so no further escaping
    // is needed.
    // -a never: see "Codex CLI: no per-tool allow-list" in apps/desktop/AGENTS.md
    // for the security rationale (the user consents by opening the embedded session).
    // -s workspace-write: keeps the OS sandbox enforced (reads anywhere, writes only
    // inside workspace cwd + $TMPDIR, network blocked) while removing the sandbox-
    // escalation prompts that -a never alone cannot suppress when the default
    // read-only sandbox tries to allow any write operation.
    // default_tools_approval_mode="always": -a never suppresses shell-command approval
    // prompts but not MCP tool-call approval prompts — those are controlled by a
    // separate per-server config field. Setting it to "always" on the injected server
    // pre-authorizes every tool call from this server without an interactive dialog.
    args.push(
      '-c',
      `mcp_servers.churro-coder-${subChatId}.url="${mcpUrl}"`,
      '-c',
      `mcp_servers.churro-coder-${subChatId}.bearer_token_env_var="CHURRO_MCP_BEARER"`,
      '-c',
      `mcp_servers.churro-coder-${subChatId}.default_tools_approval_mode="approve"`,
      '-a',
      'never',
      '-s',
      'workspace-write'
    );
  }

  const env: Record<string, string> = {
    CHURRO_SUBCHAT_ID: subChatId,
    ...(harness === 'codex-cli' ? { CHURRO_MCP_BEARER: endpoint.bearer } : {})
  };

  const bootstrap: TerminalBootstrap = {
    command: binaryPath,
    ...(args.length > 0 ? { args } : {}),
    ...(cwd ? { cwd } : {}),
    env,
    idleDetection: {
      silenceMs: 1_500
    }
  };

  console.log(
    `[harness-bootstrap] ok harness=${harness} sub=${subChatId} binary=${binaryPath} args=${JSON.stringify(args)}`
  );
  return bootstrap;
}
