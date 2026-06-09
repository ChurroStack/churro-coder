import { z } from 'zod';
import { router, publicProcedure } from '../index';
import { getDatabase, projects } from '../../db';
import { eq } from 'drizzle-orm';
import {
  detectWorktreeConfig,
  saveWorktreeConfig,
  getAvailableConfigPaths,
  type WorktreeConfig
} from '../../git/worktree-config';

const WorktreeScriptSchema = z.object({
  name: z.string().min(1).max(60),
  command: z.string().min(1)
});

const WorktreeConfigSchema = z.object({
  'setup-worktree-unix': z.union([z.array(z.string()), z.string()]).optional(),
  'setup-worktree-windows': z.union([z.array(z.string()), z.string()]).optional(),
  'setup-worktree': z.union([z.array(z.string()), z.string()]).optional(),
  scripts: z.array(WorktreeScriptSchema).optional(),
  prompts: z.record(z.string(), z.string()).optional()
});

export const worktreeConfigRouter = router({
  /**
   * Get worktree config for a project
   * Detects from .cursor/worktrees.json or .cscode/worktree.json (legacy: .1code/worktree.json read-only)
   */
  get: publicProcedure
    .input(z.object({ projectId: z.string(), worktreePath: z.string().optional() }))
    .query(async ({ input }) => {
      const db = getDatabase();
      const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();

      if (!project) {
        throw new Error('Project not found');
      }

      // Scope to the workspace's own working tree when provided so edits land in
      // that tree (and commit with its branch), not the base repo. Falls back to
      // the base repo path for Local workspaces / legacy callers.
      const scopePath = input.worktreePath ?? project.path;
      const detected = await detectWorktreeConfig(scopePath);
      const available = await getAvailableConfigPaths(scopePath);

      return {
        config: detected.config,
        path: detected.path,
        source: detected.source,
        available,
        projectPath: scopePath
      };
    }),

  /**
   * Save worktree config for a project
   */
  save: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        worktreePath: z.string().optional(),
        config: WorktreeConfigSchema,
        target: z.enum(['cursor', 'cscode']).or(z.string()).default('cscode')
      })
    )
    .mutation(async ({ input }) => {
      const db = getDatabase();
      const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();

      if (!project) {
        throw new Error('Project not found');
      }

      const scopePath = input.worktreePath ?? project.path;
      const result = await saveWorktreeConfig(scopePath, input.config as WorktreeConfig, input.target);

      return result;
    }),

  /**
   * Get available config paths for a project (optionally a specific worktree)
   */
  getAvailablePaths: publicProcedure
    .input(z.object({ projectId: z.string(), worktreePath: z.string().optional() }))
    .query(async ({ input }) => {
      const db = getDatabase();
      const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();

      if (!project) {
        throw new Error('Project not found');
      }

      return getAvailableConfigPaths(input.worktreePath ?? project.path);
    })
});
