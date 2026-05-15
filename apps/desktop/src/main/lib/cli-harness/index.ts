import { app } from 'electron';
import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { updateClaudeConfigAtomic } from '../claude-config';
import { getMcpHttpEndpoint, initMcpHttpServer } from '../mcp/http-transport';
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
  const existing = getMcpHttpEndpoint();
  if (existing) return existing;
  return initMcpHttpServer();
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
  } else {
    // Codex CLI injects MCP via -c config overrides; bearer goes through an env var
    // to avoid exposing it on the process command line. The right-hand side of
    // each -c override is parsed by Codex as a TOML value, so string values must
    // include surrounding double quotes — they are TOML string delimiters, not
    // shell quoting. Args go through execve, not a shell, so no further escaping
    // is needed.
    args.push(
      '-c',
      `mcp_servers.churro-coder-${subChatId}.url="${mcpUrl}"`,
      '-c',
      `mcp_servers.churro-coder-${subChatId}.bearer_token_env_var="CHURRO_MCP_BEARER"`
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
      silenceMs: 30_000
    }
  };

  console.log(`[harness-bootstrap] ok harness=${harness} sub=${subChatId} binary=${binaryPath}`);
  return bootstrap;
}
