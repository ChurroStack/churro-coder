import { z } from 'zod';
import { setDebugSession } from '../../debug-session';
import { publicProcedure, router } from '../index';

export const analyticsRouter = router({
  setDebugSession: publicProcedure
    .input(
      z.object({
        enabled: z.boolean()
      })
    )
    .mutation(({ input }) => {
      setDebugSession(input.enabled);
      return { success: true };
    })
});
