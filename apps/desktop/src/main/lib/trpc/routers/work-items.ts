import { z } from 'zod';
import { router, publicProcedure } from '../index';
import { getDatabase, projects, chats } from '../../db';
import { desc, inArray } from 'drizzle-orm';
import { fetchGitHubWorkItems } from '../../work-items/github';
import { getCachedWorkItems, setCachedWorkItems, appendCachedWorkItems, evictAll } from '../../work-items/cache';
import type { WorkItem, WorkItemFetchResult } from '../../work-items/types';

const GITHUB_CACHE_KEY = 'github:viewer';

function log(op: string, ok: boolean, reason?: string): void {
  const suffix = ok ? '' : ` reason="${reason?.slice(0, 200)}"`;
  console.log(`[work-items] op=${op} ok=${ok}${suffix}`);
}

function matchesProject(item: WorkItem, project: typeof projects.$inferSelect | undefined): boolean {
  if (!project) return false;
  return (
    project.gitProvider === 'github' &&
    item.provider === 'github' &&
    item.repoOwner === project.gitOwner &&
    item.repoName === project.gitRepo
  );
}

export const workItemsRouter = router({
  list: publicProcedure
    .input(z.object({ projectId: z.string().optional() }).optional())
    .query(async ({ input }): Promise<WorkItemFetchResult> => {
      const db = getDatabase();

      const allProjects = await db.select().from(projects);
      const selectedProject = input?.projectId ? allProjects.find((p) => p.id === input.projectId) : undefined;

      if (input?.projectId && !selectedProject) {
        return { items: [], error: { code: 'unknown', message: 'Project not found.' } };
      }

      const cached = getCachedWorkItems(GITHUB_CACHE_KEY);
      if (cached) {
        log('list', true);
        const items = [...cached.items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        return {
          items: selectedProject ? items.filter((item) => matchesProject(item, selectedProject)) : items,
          pageInfo: cached.pageInfo
        };
      }

      const result = await fetchGitHubWorkItems();

      if (!result.error) {
        setCachedWorkItems(GITHUB_CACHE_KEY, result.items, result.pageInfo ?? { hasNextPage: false, endCursor: null });
      }

      const items = [...result.items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

      if (result.error && items.length === 0) {
        log('list', false, result.error.message);
      } else {
        log('list', true);
      }

      return {
        items: selectedProject ? items.filter((item) => matchesProject(item, selectedProject)) : items,
        pageInfo: result.pageInfo,
        error: items.length === 0 ? result.error : undefined
      };
    }),

  refresh: publicProcedure.input(z.void().optional()).mutation(async (): Promise<WorkItemFetchResult> => {
    evictAll();

    const result = await fetchGitHubWorkItems();

    if (!result.error) {
      setCachedWorkItems(GITHUB_CACHE_KEY, result.items, result.pageInfo ?? { hasNextPage: false, endCursor: null });
    }

    const items = [...result.items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

    if (result.error && items.length === 0) {
      log('refresh', false, result.error.message);
    } else {
      log('refresh', true);
    }

    return {
      items,
      pageInfo: result.pageInfo,
      error: items.length === 0 ? result.error : undefined
    };
  }),

  loadMore: publicProcedure
    .input(z.object({ cursor: z.string() }))
    .mutation(async ({ input }): Promise<WorkItemFetchResult> => {
      const result = await fetchGitHubWorkItems(input.cursor);

      if (!result.error) {
        appendCachedWorkItems(
          GITHUB_CACHE_KEY,
          result.items,
          result.pageInfo ?? { hasNextPage: false, endCursor: null }
        );
        log('loadMore', true);
      } else {
        log('loadMore', false, result.error.message);
      }

      return {
        items: result.items,
        pageInfo: result.pageInfo,
        error: result.error
      };
    }),

  /** Returns chats whose names match the `#<number>:` pattern for the given projects.
   *  Used by MyWork to detect issues that already have an associated session. */
  linkedChats: publicProcedure
    .input(z.object({ projectIds: z.array(z.string()) }))
    .query(async ({ input }): Promise<Array<{ id: string; name: string; projectId: string; updatedAt: Date | null }>> => {
      if (!input.projectIds.length) return [];
      const db = getDatabase();
      const rows = db
        .select({ id: chats.id, name: chats.name, projectId: chats.projectId, updatedAt: chats.updatedAt })
        .from(chats)
        .where(inArray(chats.projectId, input.projectIds))
        .orderBy(desc(chats.updatedAt), desc(chats.createdAt))
        .all();
      // Only chats named like "#<number>: <title>" — i.e. created from MyWork
      return rows.filter((r) => r.name != null && /^#\d+:/.test(r.name)) as Array<{
        id: string;
        name: string;
        projectId: string;
        updatedAt: Date | null;
      }>;
    }),

  permissionHint: publicProcedure.input(z.object({ provider: z.literal('github') })).query(() => ({
    install: 'brew install gh',
    login: 'gh auth login',
    scope: 'gh auth refresh -s repo'
  }))
});
