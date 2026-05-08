import { z } from 'zod';
import { router, publicProcedure } from '../index';
import { getDatabase, projects } from '../../db';
import { eq } from 'drizzle-orm';
import { getPrompt } from '../../prompts/prompt-service';

export const promptsRouter = router({
  get: publicProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
        key: z.string(),
        vars: z.record(z.unknown()).optional()
      })
    )
    .query(async ({ input }) => {
      let projectPath: string | undefined;
      if (input.projectId) {
        const db = getDatabase();
        const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();
        projectPath = project?.path;
      }
      return getPrompt({ projectPath, key: input.key, vars: input.vars as Record<string, unknown> | undefined });
    })
});
