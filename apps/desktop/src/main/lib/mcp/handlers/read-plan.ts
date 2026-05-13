import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { eq } from 'drizzle-orm';
import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { chats, getDatabase, projects, subChats } from '../../db';
import { buildOpenspecEnvOverrides, getOpenspecBinDir } from '../../openspec/openspec-bin-path';
import { readCurrentPlan } from '../../plans/plan-store';

const execFileAsync = promisify(execFile);

interface OpenSpecPlan {
  changeId: string;
  rootDir: string;
  schemaName: string;
  state?: string;
  progress?: {
    total?: number;
    complete?: number;
    remaining?: number;
  };
  instruction?: string;
  files: Array<{
    artifactId: string;
    path: string;
    content: string;
  }>;
}

interface OpenSpecApplyInstructions {
  schemaName?: unknown;
  state?: unknown;
  progress?: unknown;
  instruction?: unknown;
  contextFiles?: unknown;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const st = await stat(path);
    return st.isDirectory();
  } catch {
    return false;
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

type OpenSpecPlanLookup =
  | { kind: 'found'; plan: OpenSpecPlan }
  | { kind: 'no-subchat' }
  | { kind: 'not-bound' }
  | { kind: 'change-missing'; changeId: string; rootDir: string }
  | { kind: 'db-error'; message: string };

async function readOpenSpecPlan(subChatId: string): Promise<OpenSpecPlanLookup> {
  let row:
    | {
        chatId: string;
        changeId: string | null;
        worktreePath: string | null;
        projectPath: string;
      }
    | undefined;
  try {
    const db = getDatabase();
    row = db
      .select({
        chatId: subChats.chatId,
        changeId: subChats.openspecChangeId,
        worktreePath: chats.worktreePath,
        projectPath: projects.path
      })
      .from(subChats)
      .innerJoin(chats, eq(subChats.chatId, chats.id))
      .innerJoin(projects, eq(chats.projectId, projects.id))
      .where(eq(subChats.id, subChatId))
      .get();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[churro-coder] read_plan openspec lookup skipped sub=${subChatId} message=${message}`);
    return { kind: 'db-error', message };
  }

  if (!row) {
    console.log(`[churro-coder] read_plan openspec found=false reason=no-subchat sub=${subChatId}`);
    return { kind: 'no-subchat' };
  }

  if (!row.changeId) {
    console.log(`[churro-coder] read_plan openspec found=false reason=not-bound sub=${subChatId}`);
    return { kind: 'not-bound' };
  }

  const rootDir =
    row.worktreePath && row.worktreePath.length > 0 && (await dirExists(row.worktreePath))
      ? row.worktreePath
      : row.projectPath;
  const openspecDir = join(rootDir, 'openspec');
  const changeDir = join(openspecDir, 'changes', row.changeId);
  if (!(await dirExists(changeDir))) {
    console.log(
      `[churro-coder] read_plan openspec found=false reason=change-missing sub=${subChatId} change=${row.changeId} root=${rootDir}`
    );
    return { kind: 'change-missing', changeId: row.changeId, rootDir };
  }

  const binName = process.platform === 'win32' ? 'openspec.cmd' : 'openspec';
  const openspecBin = join(getOpenspecBinDir(), binName);
  const args = ['instructions', 'apply', '--change', row.changeId, '--json'];
  console.log(`[churro-coder] read_plan openspec cli start sub=${subChatId} change=${row.changeId} root=${rootDir}`);
  let stdout: string;
  try {
    const result = await execFileAsync(openspecBin, args, {
      cwd: rootDir,
      env: {
        ...process.env,
        ...buildOpenspecEnvOverrides()
      },
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    });
    stdout = result.stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[churro-coder] read_plan openspec cli failed sub=${subChatId} change=${row.changeId} message=${message}`
    );
    throw new Error(`OpenSpec apply instructions failed for change "${row.changeId}": ${message}`);
  }

  let parsed: OpenSpecApplyInstructions;
  try {
    parsed = JSON.parse(stdout) as OpenSpecApplyInstructions;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[churro-coder] read_plan openspec parse failed sub=${subChatId} change=${row.changeId} message=${message}`
    );
    throw new Error(`OpenSpec returned invalid JSON for change "${row.changeId}": ${message}`);
  }

  const contextFiles = parsed.contextFiles;
  if (!contextFiles || typeof contextFiles !== 'object' || Array.isArray(contextFiles)) {
    throw new Error(`OpenSpec did not return contextFiles for change "${row.changeId}".`);
  }

  const files: OpenSpecPlan['files'] = [];
  const realRootDir = await realpath(rootDir);
  const realOpenSpecDir = await realpath(openspecDir);
  for (const [artifactId, paths] of Object.entries(contextFiles as Record<string, unknown>)) {
    if (!Array.isArray(paths)) continue;
    for (const rawPath of paths) {
      if (typeof rawPath !== 'string') continue;
      const absPath = resolve(rootDir, rawPath);
      try {
        await access(absPath, fsConstants.R_OK);
        const realAbsPath = await realpath(absPath);
        if (!isInside(realOpenSpecDir, realAbsPath)) {
          console.warn(
            `[churro-coder] read_plan openspec skipped outside file sub=${subChatId} change=${row.changeId} path=${realAbsPath}`
          );
          continue;
        }
        files.push({
          artifactId,
          path: relative(realRootDir, realAbsPath),
          content: await readFile(absPath, 'utf8')
        });
      } catch (err) {
        const code =
          typeof (err as NodeJS.ErrnoException).code === 'string' ? (err as NodeJS.ErrnoException).code : 'ERR';
        console.warn(
          `[churro-coder] read_plan openspec skipped unreadable file sub=${subChatId} change=${row.changeId} path=${absPath} code=${code}`
        );
      }
    }
  }

  const progress =
    parsed.progress && typeof parsed.progress === 'object' && !Array.isArray(parsed.progress)
      ? (parsed.progress as OpenSpecPlan['progress'])
      : undefined;

  console.log(
    `[churro-coder] read_plan openspec cli success sub=${subChatId} change=${row.changeId} files=${files.length}`
  );

  return {
    kind: 'found',
    plan: {
      changeId: row.changeId,
      rootDir,
      schemaName: typeof parsed.schemaName === 'string' ? parsed.schemaName : 'unknown',
      state: typeof parsed.state === 'string' ? parsed.state : undefined,
      progress,
      instruction: typeof parsed.instruction === 'string' ? parsed.instruction : undefined,
      files
    }
  };
}

function renderOpenSpecPlan(plan: OpenSpecPlan): string {
  const progress =
    plan.progress && typeof plan.progress.total === 'number' && typeof plan.progress.complete === 'number'
      ? `Progress: ${plan.progress.complete}/${plan.progress.total} tasks complete`
      : null;
  const header = [
    `# OpenSpec Change: ${plan.changeId}`,
    `Source: openspec:${plan.schemaName} | Root: ${plan.rootDir}`,
    plan.state ? `State: ${plan.state}` : null,
    progress,
    plan.instruction ? `Instruction: ${plan.instruction}` : null,
    ''
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const body = plan.files
    .map((file) => [`## ${file.artifactId}: ${file.path}`, '', file.content.trimEnd(), ''].join('\n'))
    .join('\n');

  return header + body;
}

export function registerReadPlanTool(server: McpServer, opts: { boundSubChatId?: string }): void {
  // Schema branches on bound vs unbound:
  //  - bound (Claude per-turn SDK instance): subChatId is closed over, the agent
  //    must NOT pass it. Schema omits the field so the agent doesn't see it.
  //  - unbound (Codex via HTTP transport): the agent MUST pass subChatId. Schema
  //    marks it required so the model's tool-call layer doesn't silently drop it
  //    when the model neglects to read the prompt-side hint.
  const inputSchema: Record<string, z.ZodTypeAny> = opts.boundSubChatId
    ? {
        revision: z
          .literal('current')
          .optional()
          .default('current')
          .describe('Plan revision to fetch. Only "current" is supported.')
      }
    : {
        subChatId: z
          .string()
          .min(1)
          .describe(
            'REQUIRED. The sub-chat ID for which to retrieve the approved plan. ' +
              'The host app provides this in the prompt context as "Sub-chat id: <value>".'
          ),
        revision: z
          .literal('current')
          .optional()
          .default('current')
          .describe('Plan revision to fetch. Only "current" is supported.')
      };

  server.registerTool(
    'read_plan',
    {
      title: 'Read Plan',
      description:
        'Retrieve the approved plan for the current sub-chat. ' +
        'Call this whenever you need to consult the plan — including after compaction or a provider switch. ' +
        'For sub-chats bound to an OpenSpec change, this tool returns the OpenSpec apply-instructions context ' +
        '(proposal, design, specs, tasks) rendered from the bundled `openspec instructions apply` CLI. ' +
        (opts.boundSubChatId
          ? ''
          : 'You MUST pass subChatId, which the host app provides in the prompt context (look for "Sub-chat id: <value>"). ' +
            'Do NOT pass the OpenSpec changeId as subChatId — they are different identifiers.'),
      inputSchema
    },
    async (input: { subChatId?: string; revision?: 'current' }) => {
      const id = opts.boundSubChatId ?? input.subChatId;
      const inputKeys = Object.keys(input).join(',') || 'none';
      console.log(
        `[churro-coder] read_plan called sub=${id ?? 'missing'} bound=${Boolean(opts.boundSubChatId)} inputKeys=${inputKeys} revision=${input.revision ?? 'current'}`
      );
      if (!id) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: subChatId is required. The host app provides it in the prompt context as "Sub-chat id: <value>" — pass that value as the subChatId argument.'
            }
          ],
          isError: true
        };
      }

      let lookup: OpenSpecPlanLookup;
      try {
        lookup = await readOpenSpecPlan(id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true
        };
      }

      if (lookup.kind === 'found') {
        const text = renderOpenSpecPlan(lookup.plan);
        console.log(
          `[churro-coder] read_plan result sub=${id} source=openspec found=true bytes=${Buffer.byteLength(text, 'utf8')}`
        );
        return { content: [{ type: 'text' as const, text }] };
      }

      if (lookup.kind === 'no-subchat') {
        console.log(`[churro-coder] read_plan result sub=${id} source=openspec found=false reason=no-subchat`);
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `Error: no sub-chat found for id "${id}". ` +
                'Check the prompt context for the correct "Sub-chat id: <value>" and pass that exact value as subChatId. ' +
                'Do not pass the OpenSpec changeId as subChatId — they are different identifiers.'
            }
          ],
          isError: true
        };
      }

      if (lookup.kind === 'db-error') {
        // DB unavailable — fall through to file-backed plan rather than blocking the agent.
        // This preserves the pre-existing fallback when SQLite can't be loaded.
        console.log(`[churro-coder] read_plan openspec db-error sub=${id} falling-through to file plan`);
      } else if (lookup.kind === 'change-missing') {
        console.log(
          `[churro-coder] read_plan result sub=${id} source=openspec found=false reason=change-missing change=${lookup.changeId}`
        );
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `Error: OpenSpec change directory not found for change "${lookup.changeId}" under "${lookup.rootDir}". ` +
                'The change may have been archived or the project path may be wrong.'
            }
          ],
          isError: true
        };
      }

      // lookup.kind === 'not-bound': fall through to file-backed plan
      const plan = await readCurrentPlan(id);
      if (!plan) {
        console.log('[churro-coder] read_plan result sub=' + id + ' found=false bytes=0');
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No plan has been recorded for this sub-chat yet. A plan is written when the planning phase completes.'
            }
          ],
          isError: true
        };
      }

      const header = [
        `# ${plan.meta.title || 'Approved Plan'}`,
        `Source: ${plan.meta.source} | Created: ${plan.meta.createdAt}${plan.meta.approvedAt ? ` | Approved: ${plan.meta.approvedAt}` : ''}`,
        ''
      ].join('\n');

      console.log(
        `[churro-coder] read_plan result sub=${id} found=true bytes=${Buffer.byteLength(plan.content, 'utf8')}`
      );

      return {
        content: [{ type: 'text' as const, text: header + plan.content }]
      };
    }
  );
}
