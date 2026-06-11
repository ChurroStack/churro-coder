import { app } from 'electron';
import { join } from 'node:path';
import { ensureMcpHttpServerAlive } from '../mcp/http-transport';
import { atomicWriteArtifact } from '../sub-chat-artifacts/atomic-write';
import { detectCliTool, evictCliDetect } from './detect';
import { getCliInstallCommands } from '../../../shared/cli-install-commands';
import { ASK_USER_QUESTION_TIMEOUT_MS } from '../../../shared/ask-user-question';
import type { TerminalBootstrap } from '../terminal/types';

export type CliHarness = 'claude-cli' | 'codex-cli';

export type BootstrapError =
  | { kind: 'binary-missing'; binary: string; hint: string; message: string }
  | { kind: 'mcp-unavailable'; message: string }
  | { kind: 'config-write-failed'; message: string };

export function isBootstrapError(v: unknown): v is BootstrapError {
  return typeof v === 'object' && v !== null && 'kind' in v;
}

/**
 * Stable single registration key. Every CLI session in this app shares this
 * one entry (Claude: a per-instance `--mcp-config` file; Codex: `-c` overrides).
 * The MCP server is a singleton HTTP endpoint; subChatId is passed by the model
 * as a tool argument on each call.
 */
const MCP_SERVER_NAME = 'churro-coder';

/**
 * Resolve the absolute path of the user's PATH-installed `claude`/`codex` via the
 * shared shell-env-aware detector (the CLIs are no longer bundled). One cache
 * lives in `detect.ts`, shared with the `newProject.detectCli` UI query — so a
 * Recheck that flips the UI to "installed" also lets the very next spawn succeed.
 */
async function resolveBinary(name: 'claude' | 'codex'): Promise<string | null> {
  const d = await detectCliTool(name);
  const path = d.available ? (d.path ?? name) : null;
  console.log(
    `[harness-bootstrap] binary resolved binary=${name} path=${path ?? '(not found)'} version=${d.version ?? 'unknown'}`
  );
  return path;
}

/** Invalidate the shared CLI-detection cache (claude/codex/openspec). */
export function invalidateBinaryCache(): void {
  evictCliDetect();
}

async function ensureMcpEndpoint(): Promise<{ url: string; bearer: string }> {
  // Every CLI spawn (initial, restart, hard-reset) must hand the new process
  // a URL that's *actually* reachable. ensureMcpHttpServerAlive pings the
  // cached server and force-restarts it if dead — so a server killed during
  // OS sleep/wake or by a sandbox without our close/error handler firing
  // can't poison the next bootstrap with a stale port.
  return ensureMcpHttpServerAlive();
}

/** Per-instance Claude MCP config file. Under this instance's userData dir, so
 * a dev build and a prod build (separate userData, separate MCP server ports)
 * never share or clobber it. */
function claudeMcpConfigPath(): string {
  return join(app.getPath('userData'), 'cli-bootstrap', 'claude-mcp.json');
}

/**
 * Write the live `churro-coder` MCP endpoint to a per-instance JSON file and
 * return its path, to be passed as `claude --mcp-config <file>`.
 *
 * Why a file instead of mutating `~/.claude.json`: that global config is shared
 * by EVERY Churro instance on the machine, but each instance runs its own MCP
 * HTTP server on its own port. A dead instance's stale port left in the shared
 * file poisoned the surviving instance's CLIs ("Unable to connect" on every
 * write_plan/request_user_input). A per-userData file is naturally isolated per
 * instance, so there is no cross-instance clobber. The file is overwritten
 * fresh on every spawn with the currently-live url + bearer.
 *
 * `--mcp-config` is used WITHOUT `--strict-mcp-config`, so the user's own
 * globally-configured MCP servers still load alongside ours.
 */
async function writeClaudeMcpConfigFile(mcpUrl: string, bearer: string): Promise<string> {
  const path = claudeMcpConfigPath();
  const config = {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'http',
        url: mcpUrl,
        headers: { Authorization: `Bearer ${bearer}` },
        // request_user_input blocks on a human; give claude-code's logical tool
        // timeout the same generous window the host backstop uses, so it doesn't
        // hard-abort the call while the user is thinking (e.g. in another
        // workspace). See src/shared/ask-user-question.ts.
        timeout: ASK_USER_QUESTION_TIMEOUT_MS
      }
    }
  };
  await atomicWriteArtifact(path, JSON.stringify(config, null, 2));
  console.log(`[harness-bootstrap] claude-cli MCP config written path=${path} url=${mcpUrl}`);
  return path;
}

const CHURRO_SUBCHAT_ID_LABEL = 'Sub-chat id';

function buildClaudeSystemPrompt(subChatId: string): string {
  return [
    `${CHURRO_SUBCHAT_ID_LABEL}: ${subChatId}`,
    'You MUST pass this exact string as the `subChatId` argument to every churro-coder MCP tool call. Re-read this line before each call.',
    '',
    'MCP persistence is mandatory in this session:',
    '- When in plan mode, you MUST call the write_plan tool with the full plan markdown before calling ExitPlanMode or presenting any approval options to the user. Do not call ExitPlanMode until write_plan has succeeded in the same turn.',
    '- When producing a code review, you MUST call the write_review tool with the full review markdown before sending your final assistant message.',
    '- When implementing a plan, you MUST call write_tasks once at the start with all plan steps (each task needs a stable short id, a title, and status: "pending"). Before starting each task call update_task_status with status: "in_progress"; after finishing call it with status: "completed". If the task structure changes, call write_tasks again with the full updated list.',
    '- After every successful file create, edit, or delete (or a batch of them in one turn), you MUST call notify_files_changed with the affected paths and actions. Batch all files from a single turn into one call. This is how the host app tracks changes in the Changes widget.',
    '- When you need to ask the user a clarifying question or get a decision, you MUST call the request_user_input MCP tool with 1-4 structured questions. The host renders the questions as a UI widget above the CLI prompt; do NOT type a question into the terminal and wait for stdin — the user will not see it.',
    '- These tools are pre-authorized; calling them does not require user approval. Skipping them leaves the user UI blank, which is a failure.'
  ].join('\n');
}

export async function buildBootstrap(
  harness: CliHarness,
  subChatId: string,
  cwd?: string,
  /**
   * When set, asks the CLI to resume an existing session by id rather than
   * starting fresh. The id is the JSONL session UUID captured by the
   * cli-session locator. Claude: `--resume <id>`. Codex: `resume <id>` as a
   * subcommand (positional arg). If the CLI rejects the flag (e.g. session
   * file was deleted), the PTY exits quickly and the renderer surfaces a
   * toast; subChats.cliSessionId should then be cleared by the caller and
   * a fresh spawn retried.
   *
   * Resume is gated on a non-empty messages count by chats.buildCliBootstrap
   * — never passed for first-ever spawns.
   */
  resumeSessionId?: string,
  /**
   * Claude only. When set and we are NOT resuming, passed as `--session-id
   * <uuid>` so claude writes its JSONL at a path we predicted before spawn.
   * This eliminates the locator's mtime-based guesswork and is the load-
   * bearing guarantee that two CLI sub-chats in the same worktree cannot
   * inherit each other's session. Ignored for codex-cli (Codex 0.130.0 has
   * no equivalent flag).
   */
  claimedSessionId?: string
): Promise<TerminalBootstrap | BootstrapError> {
  const binaryName = harness === 'claude-cli' ? 'claude' : 'codex';
  console.log(
    `[harness-bootstrap] start harness=${harness} sub=${subChatId} cwd=${cwd ?? '(none)'} resume=${resumeSessionId ?? '(none)'} claimed=${claimedSessionId ?? '(none)'}`
  );

  const binaryPath = await resolveBinary(binaryName);
  if (!binaryPath) {
    // First non-comment line from the platform install commands is the hint.
    const cmds = getCliInstallCommands(binaryName, process.platform as 'darwin' | 'win32' | 'linux');
    const install = cmds.find((c) => !c.startsWith('#')) ?? cmds[0];
    const hint = `Install with: ${install}`;
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

  const args: string[] = [];

  // Codex: resume is a SUBCOMMAND that takes the session id as a positional
  // argument. It must come first; -c / -a / -s flags follow and are accepted
  // by the resume subcommand the same way they're accepted at the top level.
  if (harness === 'codex-cli' && resumeSessionId) {
    args.push('resume', resumeSessionId);
  }

  if (harness === 'claude-cli') {
    let mcpConfigPath: string;
    try {
      mcpConfigPath = await writeClaudeMcpConfigFile(endpoint.url, endpoint.bearer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[harness-bootstrap] config-write-failed harness=${harness} sub=${subChatId} error=${message}`);
      return { kind: 'config-write-failed', message: `Failed to write Claude CLI MCP config: ${message}` };
    }
    // Load our MCP server from a per-instance file instead of the global
    // ~/.claude.json — see writeClaudeMcpConfigFile for why. No
    // --strict-mcp-config, so the user's own MCP servers still load.
    args.push('--mcp-config', mcpConfigPath);
    // Claude: --resume <id> resumes by session UUID. Pushed BEFORE the trust /
    // tools / system-prompt flags so the resume positional value is bound to
    // --resume and nothing else can claim it accidentally.
    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    } else if (claimedSessionId) {
      // Fresh spawn with a pre-allocated UUID. Tells claude to create the
      // JSONL at `~/.claude/projects/<encoded-cwd>/<claimedSessionId>.jsonl`,
      // which the locator then verifies by exact path. Without this, the
      // locator falls back to mtime guessing and can latch onto another
      // sub-chat's actively-streaming transcript (see cli-session/locator.ts
      // and apps/desktop/CLAUDE.md § Per-subChat isolation invariant).
      args.push('--session-id', claimedSessionId);
    }
    // Skip the interactive folder-trust dialog — the user explicitly launched
    // this CLI session in their own project, so trust is implicit.
    args.push('--dangerously-skip-permissions');
    // Pre-authorize MCP tools so Claude never prompts for permission on
    // write_plan / write_review / etc. Tool IDs use the static server name
    // (single registration, shared across all subChats).
    args.push(
      '--allowedTools',
      `mcp__${MCP_SERVER_NAME}__write_plan,mcp__${MCP_SERVER_NAME}__write_review,mcp__${MCP_SERVER_NAME}__write_tasks,mcp__${MCP_SERVER_NAME}__update_task_status,mcp__${MCP_SERVER_NAME}__notify_files_changed,mcp__${MCP_SERVER_NAME}__request_user_input`
    );
    // System prompt: declares the subChatId and instructs the model to pass
    // it on every MCP call. This is the primary subChatId carrier for Claude.
    args.push('--append-system-prompt', buildClaudeSystemPrompt(subChatId));
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
    // default_tools_approval_mode="approve": -a never suppresses shell-command approval
    // prompts but not MCP tool-call approval prompts — those are controlled by a
    // separate per-server config field. Setting it pre-authorizes every tool call
    // from this server without an interactive dialog.
    //
    // Note: Codex's -c overrides are per-invocation, so unlike Claude there is no
    // long-lived TOML config file we need to clean legacy entries from — each
    // launch sets only the single `churro-coder` server.
    args.push(
      '-c',
      `mcp_servers.${MCP_SERVER_NAME}.url="${endpoint.url}"`,
      '-c',
      `mcp_servers.${MCP_SERVER_NAME}.bearer_token_env_var="CHURRO_MCP_BEARER"`,
      '-c',
      `mcp_servers.${MCP_SERVER_NAME}.default_tools_approval_mode="approve"`,
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
