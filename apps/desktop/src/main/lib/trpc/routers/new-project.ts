import { z } from 'zod';
import { router, publicProcedure } from '../index';
import { observable } from '@trpc/server/observable';
import { getDatabase, projects } from '../../db';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, symlink, writeFile, readFile, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { app } from 'electron';
import { getProviderAdapter } from '../../providers/index';
import { evict } from '../../providers/detect-cache';
import { evictCliDetect } from '../../cli-harness/detect';
import { clearShellEnvCache } from '../../git/shell-env';
import type { CliTool } from '../../../../shared/cli-install-commands';
import { cloneIntoRepos } from '../../git/clone-into-repos';
import { getGitRemoteInfo } from '../../git';
import { isWindows } from '../../platform/index';
import { trackProjectCreated } from '../../analytics';
import { validateRepoNameRules } from '../../../../shared/repo-name-rules';

export type NewProjectStep =
  | 'validate'
  | 'remote-create'
  | 'clone'
  | 'scaffold'
  | 'commit'
  | 'push'
  | 'db-insert'
  | 'openspec-init';

export type NewProjectEvent =
  | { type: 'step'; step: NewProjectStep; status: 'pending' | 'done' | 'error'; message?: string }
  | { type: 'complete'; projectId: string; path: string }
  | { type: 'fatal'; step: NewProjectStep | 'rollback'; message: string };

const execAsync = promisify(exec);

function log(correlationId: string, step: string, ok: boolean, reason?: string): void {
  const suffix = ok ? '' : ` reason="${reason?.split('\n')[0].slice(0, 200)}"`;
  console.log(`[NewProject] ${correlationId} step=${step} ok=${ok}${suffix}`);
}

const providerIdSchema = z.enum(['github', 'azure', 'local']);
const cliToolSchema = z.enum(['claude', 'codex', 'openspec']);
function isCliTool(v: string): v is CliTool {
  return v === 'claude' || v === 'codex' || v === 'openspec';
}

export const newProjectRouter = router({
  /**
   * Detect whether a provider CLI (gh/az/git) or an agent CLI (claude/codex/
   * openspec) is available on PATH. Agent CLIs additionally report a version
   * gate (`requiredVersion` / `meetsMinimum`) so the UI can flag an outdated
   * install; provider CLIs omit those fields (the component treats their absence
   * as "no gate").
   */
  detectCli: publicProcedure
    .input(
      z.object({
        provider: z.union([providerIdSchema, cliToolSchema]),
        evictCache: z.boolean().default(false)
      })
    )
    .query(async ({ input }) => {
      if (input.evictCache) {
        // Also clear the shell-env cache so a CLI installed AFTER the app launched
        // (which only updates the Windows registry PATH, not process.env.PATH) is
        // picked up by the very next runCli() call — otherwise the user would have
        // to wait for the 60 s shell-env TTL to expire.
        clearShellEnvCache();
        if (isCliTool(input.provider)) evictCliDetect(input.provider);
        else evict(input.provider);
      }

      if (isCliTool(input.provider)) {
        const { detectCliTool } = await import('../../cli-harness/detect');
        const d = await detectCliTool(input.provider, { evict: input.evictCache });
        return {
          available: d.available,
          version: d.version,
          requiredVersion: d.requiredVersion,
          meetsMinimum: d.meetsMinimum
        };
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
      if (input.evictCache) {
        clearShellEnvCache();
        evict(input.provider);
      }
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

  /** Full project creation orchestrator. Streams per-step progress events. */
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
    .subscription(({ input }) => {
      return observable<NewProjectEvent>((emit) => {
        const { correlationId } = input;

        const emitStep = (step: NewProjectStep, status: 'pending' | 'done' | 'error', message?: string) => {
          console.log(`[NewProject] ${correlationId} emit step=${step} status=${status}`);
          emit.next({ type: 'step', step, status, message });
        };

        const run = async () => {
          let currentStep: NewProjectStep = 'validate';
          const compensators: Array<() => Promise<void>> = [];
          let removeRemoteCompensator: (() => Promise<void>) | null = null;

          try {
            // Step 1: Re-validate name
            emitStep('validate', 'pending');
            currentStep = 'validate';
            const nameCheck = validateRepoName(input.name, input.provider, input.accountId, input.projectId);
            if (!nameCheck.valid) {
              throw new Error(`Invalid project name: ${nameCheck.error}`);
            }
            emitStep('validate', 'done');
            log(correlationId, 'validate', true);

            const adapter = getProviderAdapter(input.provider);

            // Step 2: Create remote repo
            let cloneUrl = '';
            if (input.provider !== 'local') {
              emitStep('remote-create', 'pending');
              currentStep = 'remote-create';
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
              emitStep('remote-create', 'done');
              log(correlationId, 'remote-create', true);

              removeRemoteCompensator = async () => {
                try {
                  const a = getProviderAdapter(input.provider as 'github' | 'azure');
                  if (a.deleteRepo) {
                    await a.deleteRepo({ accountId: input.accountId, name: input.name, correlationId });
                  }
                  log(correlationId, 'compensate:remote-delete', true);
                } catch (err) {
                  log(correlationId, 'compensate:remote-delete', false, String(err));
                }
              };
              compensators.push(removeRemoteCompensator);
            }

            // Step 3: Clone or git init
            emitStep('clone', 'pending');
            currentStep = 'clone';
            let clonePath: string;
            // Track whether THIS run created the clone directory. If we reused
            // an existing dir (legacy ~/.21st fallback, or a prior interrupted
            // attempt), the rm compensator would wipe user data on rollback.
            let createdClonePath: boolean;
            if (input.provider === 'local') {
              const homePath = app.getPath('home');
              clonePath = join(homePath, '.churrostack', 'repos', 'local', input.name);
              const preExisted = existsSync(clonePath);
              await mkdir(clonePath, { recursive: true });
              await execAsync('git init --initial-branch=main', { cwd: clonePath });
              createdClonePath = !preExisted;
            } else {
              const result = await cloneIntoRepos({
                owner: input.accountId,
                repo: input.name,
                project: input.projectId,
                cloneUrl,
                providerHint: input.provider
              });
              clonePath = result.clonePath;
              createdClonePath = !result.alreadyExisted;
            }
            emitStep('clone', 'done');
            log(correlationId, 'clone', true);

            if (createdClonePath) {
              compensators.push(async () => {
                try {
                  await rm(clonePath, { recursive: true, force: true });
                  log(correlationId, 'compensate:remove-clone-dir', true);
                } catch (err) {
                  log(correlationId, 'compensate:remove-clone-dir', false, String(err));
                }
              });
            } else {
              console.log(
                `[NewProject] ${correlationId} step=compensate:remove-clone-dir-skipped reason="dir pre-existed; refusing to rm on rollback"`
              );
            }

            // Step 4: Scaffold templates
            emitStep('scaffold', 'pending');
            currentStep = 'scaffold';
            await scaffoldTemplates(clonePath, {
              name: input.name,
              description: input.description ?? '',
              prompt: input.prompt,
              openspecInit: input.openspecInit
            });
            emitStep('scaffold', 'done');
            log(correlationId, 'scaffold', true);

            // Step 5: OpenSpec init (runs in the main clone, before commit, so the
            // openspec/.claude/.codex scaffolding lands in the initial commit and
            // reaches the remote). Non-fatal: on failure we keep the templates-only commit.
            // Note: persisted openspecTools is intentionally NOT stored here — the
            // wizard no longer creates a chat row. Runtime detection via
            // detectOpenspecState() picks up the sentinel files when the user
            // creates a workspace on the New workspace screen.
            let openspecInitSucceeded = false;
            if (input.openspecInit) {
              emitStep('openspec-init', 'pending');
              currentStep = 'openspec-init';
              try {
                const { assertOpenspecBinAvailable, OpenspecCliMissingError } =
                  await import('../../openspec/openspec-bin-path');
                try {
                  await assertOpenspecBinAvailable();
                  const { runOpenspecCli } = await import('../../openspec/run-openspec-cli');
                  await runOpenspecCli(['init', '--tools', 'claude,codex', '--profile', 'core'], clonePath);
                  openspecInitSucceeded = true;
                  emitStep('openspec-init', 'done');
                  log(correlationId, 'openspec-init', true);
                } catch (e) {
                  // Distinguish a missing CLI (user hasn't installed openspec, more actionable)
                  // from a transient CLI error. Both stay non-fatal for the overall flow.
                  const isCliMissing = e instanceof OpenspecCliMissingError;
                  const rawMsg = String(e);
                  const msg = isCliMissing
                    ? `OpenSpec CLI not installed — skipping init. Install: npm install -g @fission-ai/openspec`
                    : `OpenSpec init failed (continuing without it): ${rawMsg}`;
                  emitStep('openspec-init', 'error', msg);
                  log(correlationId, 'openspec-init', false, `${isCliMissing ? 'cli-missing' : 'cli-error'} ${rawMsg}`);
                  // non-fatal: continue with templates-only commit
                }
              } catch (importErr) {
                // Failed even to load openspec-bin-path (very unlikely). Still non-fatal.
                const msg = `OpenSpec init unavailable: ${String(importErr)}`;
                emitStep('openspec-init', 'error', msg);
                log(correlationId, 'openspec-init', false, msg);
              }
            }

            // Re-render AGENTS.md with the actual openspec outcome so the postmortems
            // pointer doesn't reference openspec/postmortems when openspec init failed.
            // Safe to overwrite: if openspec init failed it didn't add its managed block,
            // so we just replace the placeholder. (When openspec init succeeded, AGENTS.md
            // already has the right pointer and openspec init may have prepended a managed
            // block on top — we don't touch it in that case.)
            if (input.openspecInit && !openspecInitSucceeded) {
              try {
                await renderAgentsMd(clonePath, {
                  name: input.name,
                  description: input.description ?? '',
                  prompt: input.prompt,
                  openspecInit: false
                });
              } catch (err) {
                log(correlationId, 'agents-md-rewrite', false, String(err));
                // best-effort: keep going even if the rewrite fails
              }
            }

            // Step 6: Initial commit (captures templates + openspec scaffolding)
            emitStep('commit', 'pending');
            currentStep = 'commit';
            await execAsync('git add .', { cwd: clonePath });
            try {
              await execAsync('git commit -m "Initial commit"', { cwd: clonePath });
            } catch (commitErr) {
              const raw = commitErr instanceof Error ? commitErr.message : String(commitErr);
              if (/gpg|signing|secret key|no secret key|gpg failed/i.test(raw)) {
                throw new Error(
                  `Initial commit failed because git commit signing is enabled but signing failed. Either disable signing for this repo (\`git config commit.gpgsign false\`) or fix your GPG/SSH signing key, then retry.\n\nUnderlying error: ${raw}`
                );
              }
              throw commitErr;
            }
            emitStep('commit', 'done');
            log(correlationId, 'commit', true);

            // Step 7: Push (remote providers only). Resolve the actual current
            // branch rather than hard-coding 'main' — empty Azure DevOps repos
            // (or users with init.defaultBranch=master) clone with a non-main
            // HEAD, and `git push -u origin main` would fail with
            // "src refspec main does not match any."
            if (input.provider !== 'local') {
              emitStep('push', 'pending');
              currentStep = 'push';
              let currentBranch = 'main';
              try {
                const result = await execAsync('git symbolic-ref --short HEAD', { cwd: clonePath });
                const out = typeof result === 'string' ? result : ((result as { stdout?: string }).stdout ?? '');
                const trimmed = out.trim();
                if (trimmed) currentBranch = trimmed;
              } catch {
                // Couldn't read HEAD (detached, unexpected error) — fall back
                // to 'main' to stay consistent with the local git-init default.
              }
              await execAsync(`git push -u origin ${currentBranch}`, { cwd: clonePath });
              emitStep('push', 'done');
              log(correlationId, 'push', true);
              // Clear remote-delete compensator — push succeeded, repo is canonical.
              // Use identity-based removal so future compensators inserted between
              // remote-create and push don't get dropped by mistake.
              if (removeRemoteCompensator) {
                const idx = compensators.indexOf(removeRemoteCompensator);
                if (idx !== -1) compensators.splice(idx, 1);
                removeRemoteCompensator = null;
              }
            }

            // Step 8: Insert project row
            emitStep('db-insert', 'pending');
            currentStep = 'db-insert';
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
            emitStep('db-insert', 'done');
            log(correlationId, 'db-insert', true);

            // No chat / worktree creation here on purpose. The user lands on the
            // "New workspace" screen with this project selected and creates the
            // workspace (chat + worktree) from there using the normal flow.

            trackProjectCreated({ provider: input.provider, openspecInit: input.openspecInit, hasPrompt: true });
            log(correlationId, 'done', true);

            console.log(
              `[NewProject] ${correlationId} emit type=complete projectId=${project.id} path=${project.path}`
            );
            emit.next({ type: 'complete', projectId: project.id, path: project.path });
            emit.complete();
          } catch (err) {
            const message = String(err);
            emitStep(currentStep, 'error', message);
            log(correlationId, 'rollback', false, message);
            for (const comp of [...compensators].reverse()) {
              try {
                await comp();
              } catch {
                /* best-effort */
              }
            }
            console.log(`[NewProject] ${correlationId} emit type=fatal step=${currentStep}`);
            emit.next({ type: 'fatal', step: currentStep, message });
            emit.complete();
          }
        };

        run().catch((err) => {
          emit.error(err);
        });

        return () => {};
      });
    })
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface NameValidationResult {
  valid: boolean;
  error?: string;
}

function validateRepoName(
  name: string,
  provider: 'github' | 'azure' | 'local',
  accountId: string,
  projectId?: string
): NameValidationResult {
  // Pure rules (regex, reserved, length) live in shared/repo-name-rules.ts so
  // the renderer and the main process can't drift apart.
  const rulesResult = validateRepoNameRules(name, provider);
  if (!rulesResult.valid) return rulesResult;

  // Path-existence check stays here: it needs access to app.getPath('home')
  // and isn't reachable from the renderer.
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

function getTemplateDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'new-project-templates')
    : join(__dirname, '..', '..', 'resources', 'new-project-templates');
}

/**
 * Render and write AGENTS.md (and CLAUDE.md on Windows as a duplicate copy).
 * Exposed separately from scaffoldTemplates so the orchestrator can re-render
 * with the actual openspec outcome after init.
 */
async function renderAgentsMd(clonePath: string, vars: ScaffoldVars): Promise<void> {
  const { renderTemplate } = await import('../../providers/templates');
  const agentsMd = await renderTemplate(join(getTemplateDir(), 'AGENTS.md.tmpl'), {
    name: vars.name,
    description: vars.description,
    prompt: vars.prompt,
    postmortemsDir: vars.openspecInit ? 'openspec/postmortems' : 'docs/postmortems'
  });
  await writeFile(join(clonePath, 'AGENTS.md'), agentsMd, 'utf8');

  // On Windows, CLAUDE.md is a duplicate copy of AGENTS.md (no symlinks),
  // so it must be kept in sync. On macOS/Linux it's a symlink — already current.
  if (isWindows()) {
    await writeFile(join(clonePath, 'CLAUDE.md'), agentsMd, 'utf8');
  }
}

async function scaffoldTemplates(clonePath: string, vars: ScaffoldVars): Promise<void> {
  const { renderTemplate } = await import('../../providers/templates');
  const templateDir = getTemplateDir();

  await renderAgentsMd(clonePath, vars);

  // CLAUDE.md symlink on macOS/Linux (Windows path handled inside renderAgentsMd above).
  if (!isWindows()) {
    await symlink('AGENTS.md', join(clonePath, 'CLAUDE.md'));
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
