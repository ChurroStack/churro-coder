import { z } from 'zod';
import { router, publicProcedure } from '../index';
import { chats, getDatabase, projects, subChats } from '../../db';
import { eq, desc, inArray } from 'drizzle-orm';
import { dialog, BrowserWindow, app } from 'electron';
import { basename, join } from 'path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, copyFile, unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import { getGitRemoteInfo } from '../../git';
import { cloneIntoRepos, parseGitHubRef, parseAzureDevOpsRef } from '../../git/clone-into-repos';
import { terminalManager } from '../../terminal/manager';
import { trackProjectOpened } from '../../analytics';
import { getLaunchDirectory } from '../../cli';
import { abortClaudeSessionsForSubChats } from './claude';

const execAsync = promisify(exec);

export const projectsRouter = router({
  /**
   * Get launch directory from CLI args (consumed once)
   * Based on PR #16 by @caffeinum
   */
  getLaunchDirectory: publicProcedure.query(() => {
    return getLaunchDirectory();
  }),

  /**
   * List all projects
   */
  list: publicProcedure.query(() => {
    const db = getDatabase();
    return db.select().from(projects).orderBy(desc(projects.updatedAt)).all();
  }),

  /**
   * Get a single project by ID
   */
  get: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const db = getDatabase();
    return db.select().from(projects).where(eq(projects.id, input.id)).get();
  }),

  /**
   * Open folder picker and create project
   */
  openFolder: publicProcedure.mutation(async ({ ctx }) => {
    const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow();

    if (!window) {
      console.error('[Projects] No window available for folder dialog');
      return null;
    }

    // Ensure window is focused before showing dialog (fixes first-launch timing issue on macOS)
    if (!window.isFocused()) {
      console.log('[Projects] Window not focused, focusing before dialog...');
      window.focus();
      // Small delay to ensure focus is applied by the OS
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Project Folder',
      buttonLabel: 'Open Project'
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const folderPath = result.filePaths[0]!;
    const folderName = basename(folderPath);

    // Get git remote info
    const gitInfo = await getGitRemoteInfo(folderPath);

    const db = getDatabase();

    // Check if project already exists
    const existing = db.select().from(projects).where(eq(projects.path, folderPath)).get();

    if (existing) {
      // Update the updatedAt timestamp and git info (in case remote changed)
      const updatedProject = db
        .update(projects)
        .set({
          updatedAt: new Date(),
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
          gitProject: gitInfo.project
        })
        .where(eq(projects.id, existing.id))
        .returning()
        .get();

      // Track project opened
      trackProjectOpened({
        id: updatedProject!.id,
        hasGitRemote: !!gitInfo.remoteUrl
      });

      return updatedProject;
    }

    // Create new project with git info
    const newProject = db
      .insert(projects)
      .values({
        name: folderName,
        path: folderPath,
        gitRemoteUrl: gitInfo.remoteUrl,
        gitProvider: gitInfo.provider,
        gitOwner: gitInfo.owner,
        gitRepo: gitInfo.repo,
        gitProject: gitInfo.project
      })
      .returning()
      .get();

    // Track project opened
    trackProjectOpened({
      id: newProject!.id,
      hasGitRemote: !!gitInfo.remoteUrl
    });

    return newProject;
  }),

  /**
   * Create a project from a known path
   */
  create: publicProcedure
    .input(z.object({ path: z.string(), name: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = getDatabase();
      const name = input.name || basename(input.path);

      // Check if project already exists
      const existing = db.select().from(projects).where(eq(projects.path, input.path)).get();

      if (existing) {
        return existing;
      }

      // Get git remote info
      const gitInfo = await getGitRemoteInfo(input.path);

      return db
        .insert(projects)
        .values({
          name,
          path: input.path,
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
          gitProject: gitInfo.project
        })
        .returning()
        .get();
    }),

  /**
   * Rename a project
   */
  rename: publicProcedure.input(z.object({ id: z.string(), name: z.string().min(1) })).mutation(({ input }) => {
    const db = getDatabase();
    return db
      .update(projects)
      .set({ name: input.name, updatedAt: new Date() })
      .where(eq(projects.id, input.id))
      .returning()
      .get();
  }),

  /**
   * Remove a project from the list. Worktree directories on disk are preserved —
   * the "Remove" dialog explicitly promises "Your files will not be deleted."
   * The only path that may delete a worktree is archiving a workspace with the
   * "Delete worktree" checkbox explicitly checked.
   */
  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDatabase();
    const project = db.select().from(projects).where(eq(projects.id, input.id)).get();
    if (!project) {
      return null;
    }

    const childChatIds = db
      .select({ id: chats.id })
      .from(chats)
      .where(eq(chats.projectId, input.id))
      .all()
      .map((row) => row.id);

    if (childChatIds.length > 0) {
      const subChatIds = db
        .select({ id: subChats.id })
        .from(subChats)
        .where(inArray(subChats.chatId, childChatIds))
        .all()
        .map((row) => row.id);

      if (subChatIds.length > 0) {
        abortClaudeSessionsForSubChats(subChatIds);
      }

      for (const chatId of childChatIds) {
        terminalManager.killByWorkspaceId(chatId).catch(() => {});
      }
    }

    return db.delete(projects).where(eq(projects.id, input.id)).returning().get();
  }),

  /**
   * Refresh git info for a project (in case remote changed)
   */
  refreshGitInfo: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    const db = getDatabase();

    // Get project
    const project = db.select().from(projects).where(eq(projects.id, input.id)).get();

    if (!project) {
      return null;
    }

    // Get fresh git info
    const gitInfo = await getGitRemoteInfo(project.path);

    // Update project
    return db
      .update(projects)
      .set({
        updatedAt: new Date(),
        gitRemoteUrl: gitInfo.remoteUrl,
        gitProvider: gitInfo.provider,
        gitOwner: gitInfo.owner,
        gitRepo: gitInfo.repo,
        gitProject: gitInfo.project
      })
      .where(eq(projects.id, input.id))
      .returning()
      .get();
  }),

  /**
   * Clone a GitHub or Azure DevOps repo and create a project. Mutation name
   * preserved for back-compat with renderer callers; Azure DevOps URLs are
   * accepted and routed through the Azure path layout.
   */
  cloneFromGitHub: publicProcedure.input(z.object({ repoUrl: z.string() })).mutation(async ({ input }) => {
    const { repoUrl } = input;

    // Try Azure DevOps first — it has a more specific URL shape, so any URL
    // matching it is unambiguous.
    const azure = parseAzureDevOpsRef(repoUrl);
    let clonePath: string;
    let projectName: string;
    if (azure) {
      const { org, project, repo } = azure;
      const { clonePath: cp } = await cloneIntoRepos({
        owner: org,
        repo,
        project,
        cloneUrl: repoUrl,
        providerHint: 'azure'
      });
      clonePath = cp;
      projectName = repo;
    } else {
      const parsed = parseGitHubRef(repoUrl);
      if (!parsed) {
        throw new Error(
          'Invalid repo format. Use a GitHub URL (owner/repo or https://github.com/...) or Azure DevOps clone URL (https://dev.azure.com/org/project/_git/repo).'
        );
      }
      const { owner, repo } = parsed;
      const cloneUrl = `https://github.com/${owner}/${repo}.git`;
      const { clonePath: cp } = await cloneIntoRepos({ owner, repo, cloneUrl, providerHint: 'github' });
      clonePath = cp;
      projectName = repo;
    }

    // Check DB for existing project at this path
    const db = getDatabase();
    const existing = db.select().from(projects).where(eq(projects.path, clonePath)).get();
    if (existing) {
      trackProjectOpened({ id: existing.id, hasGitRemote: !!existing.gitRemoteUrl });
      return existing;
    }

    const gitInfo = await getGitRemoteInfo(clonePath);
    const newProject = db
      .insert(projects)
      .values({
        name: projectName,
        path: clonePath,
        gitRemoteUrl: gitInfo.remoteUrl,
        gitProvider: gitInfo.provider,
        gitOwner: gitInfo.owner,
        gitRepo: gitInfo.repo,
        gitProject: gitInfo.project
      })
      .returning()
      .get();

    trackProjectOpened({ id: newProject!.id, hasGitRemote: !!gitInfo.remoteUrl });
    return newProject;
  }),

  /**
   * Open folder picker to locate an existing clone of a specific repo
   * Validates that the selected folder matches the expected owner/repo
   */
  locateAndAddProject: publicProcedure
    .input(
      z.object({
        expectedOwner: z.string(),
        expectedRepo: z.string()
      })
    )
    .mutation(async ({ input, ctx }) => {
      const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow();

      if (!window) {
        return { success: false as const, reason: 'no-window' as const };
      }

      // Ensure window is focused
      if (!window.isFocused()) {
        window.focus();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const result = await dialog.showOpenDialog(window, {
        properties: ['openDirectory'],
        title: `Locate ${input.expectedOwner}/${input.expectedRepo}`,
        buttonLabel: 'Select'
      });

      if (result.canceled || !result.filePaths[0]) {
        return { success: false as const, reason: 'canceled' as const };
      }

      const folderPath = result.filePaths[0];
      const gitInfo = await getGitRemoteInfo(folderPath);

      // Validate it's the correct repo
      if (gitInfo.owner !== input.expectedOwner || gitInfo.repo !== input.expectedRepo) {
        return {
          success: false as const,
          reason: 'wrong-repo' as const,
          found: gitInfo.owner && gitInfo.repo ? `${gitInfo.owner}/${gitInfo.repo}` : 'not a git repository'
        };
      }

      // Create or update project
      const db = getDatabase();
      const existing = db.select().from(projects).where(eq(projects.path, folderPath)).get();

      if (existing) {
        // Update git info in case it changed
        const updated = db
          .update(projects)
          .set({
            updatedAt: new Date(),
            gitRemoteUrl: gitInfo.remoteUrl,
            gitProvider: gitInfo.provider,
            gitOwner: gitInfo.owner,
            gitRepo: gitInfo.repo,
            gitProject: gitInfo.project
          })
          .where(eq(projects.id, existing.id))
          .returning()
          .get();

        return { success: true as const, project: updated };
      }

      const project = db
        .insert(projects)
        .values({
          name: basename(folderPath),
          path: folderPath,
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
          gitProject: gitInfo.project
        })
        .returning()
        .get();

      return { success: true as const, project };
    }),

  /**
   * Open folder picker to choose where to clone a repository
   */
  pickCloneDestination: publicProcedure
    .input(z.object({ suggestedName: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow();

      if (!window) {
        return { success: false as const, reason: 'no-window' as const };
      }

      // Ensure window is focused
      if (!window.isFocused()) {
        window.focus();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Default to ~/.churrostack/repos/
      const homePath = app.getPath('home');
      const defaultPath = join(homePath, '.churrostack', 'repos');
      await mkdir(defaultPath, { recursive: true });

      const result = await dialog.showOpenDialog(window, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Choose where to clone',
        defaultPath,
        buttonLabel: 'Clone Here'
      });

      if (result.canceled || !result.filePaths[0]) {
        return { success: false as const, reason: 'canceled' as const };
      }

      const targetPath = join(result.filePaths[0], input.suggestedName);
      return { success: true as const, targetPath };
    }),

  /**
   * Upload a custom icon for a project (opens file picker for images)
   */
  uploadIcon: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow();
    if (!window) return null;

    if (!window.isFocused()) {
      window.focus();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      title: 'Select Project Icon',
      buttonLabel: 'Set Icon',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp', 'ico'] }]
    });

    if (result.canceled || !result.filePaths[0]) return null;

    const sourcePath = result.filePaths[0];
    const ext = extname(sourcePath);
    const iconsDir = join(app.getPath('userData'), 'project-icons');
    await mkdir(iconsDir, { recursive: true });

    const destPath = join(iconsDir, `${input.id}${ext}`);
    await copyFile(sourcePath, destPath);

    const db = getDatabase();
    return db
      .update(projects)
      .set({ iconPath: destPath, updatedAt: new Date() })
      .where(eq(projects.id, input.id))
      .returning()
      .get();
  }),

  /**
   * Remove custom icon for a project
   */
  removeIcon: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    const db = getDatabase();
    const project = db.select().from(projects).where(eq(projects.id, input.id)).get();

    if (project?.iconPath && existsSync(project.iconPath)) {
      try {
        await unlink(project.iconPath);
      } catch {}
    }

    return db
      .update(projects)
      .set({ iconPath: null, updatedAt: new Date() })
      .where(eq(projects.id, input.id))
      .returning()
      .get();
  })
});
