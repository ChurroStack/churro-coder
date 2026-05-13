import { z } from 'zod';
import { router, publicProcedure } from '../index';
import { getDatabase, projects, chats, subChats } from '../../db';
import { eq } from 'drizzle-orm';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, symlink, writeFile, readFile, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { app } from 'electron';
import { getProviderAdapter } from '../../providers/index';
import { evict } from '../../providers/detect-cache';
import { cloneIntoRepos } from '../../git/clone-into-repos';
import { getGitRemoteInfo } from '../../git';
import { createWorktreeForChat } from '../../git/worktree';
import { isWindows } from '../../platform/index';
import { trackProjectCreated } from '../../analytics';

const execAsync = promisify(exec);

function log(correlationId: string, step: string, ok: boolean, reason?: string): void {
  const suffix = ok ? '' : ` reason="${reason?.split('\n')[0].slice(0, 200)}"`;
  console.log(`[NewProject] ${correlationId} step=${step} ok=${ok}${suffix}`);
}

const providerIdSchema = z.enum(['github', 'azure', 'local']);

export const newProjectRouter = router({
  /** Detect whether the provider CLI (or openspec binary) is available. */
  detectCli: publicProcedure
    .input(
      z.object({
        provider: z.union([providerIdSchema, z.literal('openspec')]),
        evictCache: z.boolean().default(false)
      })
    )
    .query(async ({ input }) => {
      if (input.evictCache && input.provider !== 'openspec') {
        evict(input.provider);
      }

      if (input.provider === 'openspec') {
        try {
          const { assertOpenspecBinAvailable } = await import('../../openspec/openspec-bin-path');
          assertOpenspecBinAvailable();
          return { available: true, version: 'bundled' };
        } catch {
          return { available: false };
        }
      }

      const adapter = getProviderAdapter(input.provider);
      return adapter.detectCli(`detect-${input.provider}`);
    }),

  /** Check whether the user is authenticated with the provider CLI. */
  checkAuth: publicProcedure
    .input(
      z.object({
        provider: providerIdSchema,
        evictCache: z.boolean().default(false)
      })
    )
    .query(async ({ input }) => {
      if (input.evictCache) evict(input.provider);
      const adapter = getProviderAdapter(input.provider);
      return adapter.checkAuth(`auth-${input.provider}`);
    }),

  /** List GitHub accounts / Azure DevOps org URLs available to the authenticated user. */
  listAccounts: publicProcedure.input(z.object({ provider: providerIdSchema })).query(async ({ input }) => {
    const adapter = getProviderAdapter(input.provider);
    return adapter.listAccounts(`accounts-${input.provider}`);
  }),

  /** List Azure DevOps projects for a given org URL. Returns null for GitHub and Local. */
  listProjects: publicProcedure
    .input(z.object({ provider: providerIdSchema, accountId: z.string() }))
    .query(async ({ input }) => {
      const adapter = getProviderAdapter(input.provider);
      return adapter.listProjects(input.accountId, `projects-${input.provider}`);
    }),

  /** Synchronous name validation — regex, reserved names, length, and target-path existence. */
  validateName: publicProcedure
    .input(
      z.object({
        provider: providerIdSchema,
        accountId: z.string(),
        projectId: z.string().optional(),
        name: z.string()
      })
    )
    .query(({ input }) => {
      return validateRepoName(input.name, input.provider, input.accountId, input.projectId);
    }),

  /** Full project creation orchestrator. */
  createProject: publicProcedure
    .input(
      z.object({
        provider: providerIdSchema,
        accountId: z.string(),
        projectId: z.string().optional(),
        name: z.string().min(1).max(100),
        description: z.string().max(350).optional(),
        visibility: z.enum(['public', 'private']).optional(),
        openspecInit: z.boolean().default(false),
        prompt: z.string().min(10).max(4000),
        correlationId: z.string()
      })
    )
    .mutation(async ({ input }) => {
      const { correlationId } = input;

      // Step 1: Re-validate name
      const nameCheck = validateRepoName(input.name, input.provider, input.accountId, input.projectId);
      if (!nameCheck.valid) {
        throw new Error(`Invalid project name: ${nameCheck.error}`);
      }
      log(correlationId, 'validate', true);

      const adapter = getProviderAdapter(input.provider);
      const compensators: Array<() => Promise<void>> = [];

      try {
        // Step 2: Create remote repo
        let cloneUrl = '';
        if (input.provider !== 'local') {
          const repoResult = await adapter.createRepo({
            name: input.name,
            description: input.description,
            accountId: input.accountId,
            projectId: input.projectId,
            visibility: input.visibility ?? 'private',
            correlationId
          });
          if (!repoResult.ok) {
            log(correlationId, 'remote-create', false, repoResult.message);
            throw new Error(repoResult.message);
          }
          cloneUrl = repoResult.cloneUrl;
          log(correlationId, 'remote-create', true);

          compensators.push(async () => {
            try {
              const adapter = getProviderAdapter(input.provider as 'github' | 'azure');
              if ('deleteRepo' in adapter && typeof (adapter as any).deleteRepo === 'function') {
                await (adapter as any).deleteRepo({ accountId: input.accountId, name: input.name, correlationId });
              }
              log(correlationId, 'compensate:remote-delete', true);
            } catch (err) {
              log(correlationId, 'compensate:remote-delete', false, String(err));
            }
          });
        }

        // Step 3: Clone or git init
        let clonePath: string;
        if (input.provider === 'local') {
          const homePath = app.getPath('home');
          clonePath = join(homePath, '.churrostack', 'repos', 'local', input.name);
          await mkdir(clonePath, { recursive: true });
          await execAsync('git init --initial-branch=main', { cwd: clonePath });
          log(correlationId, 'clone', true);
        } else {
          const result = await cloneIntoRepos({
            owner: input.accountId,
            repo: input.name,
            project: input.projectId,
            cloneUrl,
            providerHint: input.provider
          });
          clonePath = result.clonePath;
          log(correlationId, 'clone', true);
        }

        compensators.push(async () => {
          try {
            await rm(clonePath, { recursive: true, force: true });
            log(correlationId, 'compensate:remove-clone-dir', true);
          } catch (err) {
            log(correlationId, 'compensate:remove-clone-dir', false, String(err));
          }
        });

        // Step 4: Scaffold templates
        await scaffoldTemplates(clonePath, {
          name: input.name,
          description: input.description ?? '',
          prompt: input.prompt,
          openspecInit: input.openspecInit
        });
        log(correlationId, 'scaffold', true);

        // Step 5: Initial commit
        await execAsync('git add .', { cwd: clonePath });
        await execAsync('git commit -m "Initial commit"', { cwd: clonePath });
        log(correlationId, 'commit', true);

        // Step 6: Push (remote providers only)
        if (input.provider !== 'local') {
          await execAsync('git push -u origin main', { cwd: clonePath });
          log(correlationId, 'push', true);
          // Clear remote-delete compensator — push succeeded, repo is canonical
          compensators.pop();
        }

        // Step 7: Insert project row
        const db = getDatabase();
        const gitInfo = await getGitRemoteInfo(clonePath);
        const project = db
          .insert(projects)
          .values({
            name: input.name,
            path: clonePath,
            gitRemoteUrl: gitInfo.remoteUrl,
            gitProvider: gitInfo.provider,
            gitOwner: gitInfo.owner,
            gitRepo: gitInfo.repo,
            gitProject: gitInfo.project
          })
          .returning()
          .get();
        log(correlationId, 'db-insert', true);

        // Step 8: Create chat + subChat
        const chat = db.insert(chats).values({ name: input.name, projectId: project.id }).returning().get();
        const subChat = db.insert(subChats).values({ chatId: chat.id, mode: 'execute' }).returning().get();
        log(correlationId, 'chat-create', true);

        // Step 9: Create worktree
        await createWorktreeForChat(clonePath, input.name, chat.id);
        log(correlationId, 'worktree-create', true);

        // Step 10: OpenSpec init (non-fatal)
        if (input.openspecInit) {
          try {
            const { assertOpenspecBinAvailable } = await import('../../openspec/openspec-bin-path');
            assertOpenspecBinAvailable();
            const worktreeChat = db.select().from(chats).where(eq(chats.id, chat.id)).get();
            const targetPath = worktreeChat?.worktreePath ?? clonePath;
            const { runOpenspecCli } = await import('../../openspec/run-openspec-cli');
            await runOpenspecCli(['init', '--tools', 'claude,codex', '--profile', 'core'], targetPath);
            db.update(chats)
              .set({ openspecTools: JSON.stringify(['claude', 'codex']) })
              .where(eq(chats.id, chat.id))
              .run();
            log(correlationId, 'openspec-init', true);
          } catch (e) {
            log(correlationId, 'openspec-init', false, String(e));
            // non-fatal
          }
        }

        trackProjectCreated({ provider: input.provider, openspecInit: input.openspecInit, hasPrompt: true });
        log(correlationId, 'done', true);

        return { projectId: project.id, chatId: chat.id, subChatId: subChat.id };
      } catch (err) {
        log(correlationId, 'rollback', false, String(err));
        for (const comp of compensators.reverse()) {
          try {
            await comp();
          } catch {
            /* best-effort */
          }
        }
        throw err;
      }
    })
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface NameValidationResult {
  valid: boolean;
  error?: string;
}

function validateRepoName(name: string, provider: string, accountId: string, projectId?: string): NameValidationResult {
  if (!name) return { valid: false, error: 'Name is required' };
  if (name.length > 100) return { valid: false, error: 'Name must be 100 characters or fewer' };

  if (provider === 'github') {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
      return { valid: false, error: 'Only letters, numbers, hyphens, underscores, and dots are allowed' };
    }
    if (/\.\./.test(name)) return { valid: false, error: 'Name cannot contain consecutive dots' };
    if (name === '.' || name === '..') return { valid: false, error: 'Invalid name' };
  } else if (provider === 'azure') {
    if (/[/\\:*?"<>|]/.test(name)) return { valid: false, error: 'Name contains invalid characters' };
  }

  const reserved = ['.git', 'con', 'prn', 'aux', 'nul', 'com0', 'com1', 'lpt0', 'lpt1'];
  if (reserved.includes(name.toLowerCase())) return { valid: false, error: 'That name is reserved' };

  // Check target path on disk
  const homePath = app.getPath('home');
  let targetPath: string;
  if (provider === 'azure' && projectId) {
    targetPath = join(homePath, '.churrostack', 'repos', accountId, projectId, name);
  } else if (provider === 'local') {
    targetPath = join(homePath, '.churrostack', 'repos', 'local', name);
  } else {
    targetPath = join(homePath, '.churrostack', 'repos', accountId, name);
  }

  if (existsSync(targetPath)) {
    return { valid: false, error: 'A project with that name already exists locally' };
  }

  return { valid: true };
}

interface ScaffoldVars {
  name: string;
  description: string;
  prompt: string;
  openspecInit: boolean;
}

async function scaffoldTemplates(clonePath: string, vars: ScaffoldVars): Promise<void> {
  const { renderTemplate } = await import('../../providers/templates');
  const templateDir = join(app.getAppPath(), '..', 'resources', 'new-project-templates');

  const agentsMd = await renderTemplate(join(templateDir, 'AGENTS.md.tmpl'), {
    name: vars.name,
    description: vars.description,
    prompt: vars.prompt,
    postmortemsDir: vars.openspecInit ? 'openspec/postmortems' : 'docs/postmortems'
  });
  await writeFile(join(clonePath, 'AGENTS.md'), agentsMd, 'utf8');

  // CLAUDE.md: symlink on macOS/Linux, copy on Windows
  const claudeMdTarget = join(clonePath, 'CLAUDE.md');
  if (isWindows()) {
    await writeFile(claudeMdTarget, agentsMd, 'utf8');
  } else {
    await symlink('AGENTS.md', claudeMdTarget);
  }

  const readmeMd = await renderTemplate(join(templateDir, 'README.md.tmpl'), {
    name: vars.name,
    description: vars.description
  });
  await writeFile(join(clonePath, 'README.md'), readmeMd, 'utf8');

  const gitignore = await renderTemplate(join(templateDir, '.gitignore.tmpl'), {});
  await writeFile(join(clonePath, '.gitignore'), gitignore, 'utf8');

  // .github/copilot-instructions.md
  const githubDir = join(clonePath, '.github');
  await mkdir(githubDir, { recursive: true });
  const copilot = await renderTemplate(join(templateDir, 'copilot-instructions.md.tmpl'), {});
  await writeFile(join(githubDir, 'copilot-instructions.md'), copilot, 'utf8');

  // .cursor/rules
  const cursorDir = join(clonePath, '.cursor');
  await mkdir(cursorDir, { recursive: true });
  const cursorRules = await renderTemplate(join(templateDir, 'cursor-rules.tmpl'), {});
  await writeFile(join(cursorDir, 'rules'), cursorRules, 'utf8');
}
