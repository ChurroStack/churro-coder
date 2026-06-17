import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { getDatabase, projectEnvironmentVariables } from '../../db';
import { createId } from '../../db/utils';
import { decryptSecret, encryptSecret, isSecretEncryptionAvailable } from '../../db/env-secret';
import { publicProcedure, router } from '../index';

/** Masked placeholder returned to the renderer for protected values. */
const MASK = '••••••••';

/**
 * POSIX-ish env var name: letter/underscore first, then letters/digits/underscore.
 * Rejects names that a shell could not export (spaces, `=`, leading digits, …).
 */
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const keySchema = z
  .string()
  .min(1)
  .max(256)
  .refine((k) => ENV_KEY_RE.test(k), {
    message: 'Invalid env var name (use letters, digits, underscore; no leading digit)'
  });

/**
 * Project-level environment variables. Stored project-wide (shared across all
 * worktrees) and injected into every spawned process at session-creation time
 * (see `terminal/project-env.ts`). Protected values are encrypted at rest via
 * `db/env-secret.ts` and never returned decrypted by `list` — only `reveal`
 * decrypts a single value on demand.
 */
export const projectEnvRouter = router({
  /** List a project's env vars. Protected values are masked, never decrypted. */
  list: publicProcedure.input(z.object({ projectId: z.string().min(1) })).query(({ input }) => {
    const db = getDatabase();
    const rows = db
      .select()
      .from(projectEnvironmentVariables)
      .where(eq(projectEnvironmentVariables.projectId, input.projectId))
      .orderBy(projectEnvironmentVariables.key)
      .all();

    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      value: r.isProtected ? MASK : r.value,
      isProtected: r.isProtected
    }));
  }),

  /**
   * Create or update a variable (upsert on (projectId, key)). When a protected
   * row is updated without a new value (the UI sends an empty string because the
   * masked value was untouched), the existing stored value is preserved.
   */
  set: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        key: keySchema,
        value: z.string(),
        isProtected: z.boolean()
      })
    )
    .mutation(({ input }) => {
      const db = getDatabase();
      const existing = db
        .select()
        .from(projectEnvironmentVariables)
        .where(
          and(
            eq(projectEnvironmentVariables.projectId, input.projectId),
            eq(projectEnvironmentVariables.key, input.key)
          )
        )
        .get();

      // Decide the stored value. For a protected var whose value field is blank
      // on update, keep what's already there (the user didn't retype the secret).
      let storedValue: string;
      if (input.isProtected) {
        if (input.value === '' && existing?.isProtected) {
          storedValue = existing.value;
        } else {
          storedValue = encryptSecret(input.value);
        }
      } else {
        storedValue = input.value;
      }

      if (existing) {
        db.update(projectEnvironmentVariables)
          .set({ value: storedValue, isProtected: input.isProtected, updatedAt: new Date() })
          .where(eq(projectEnvironmentVariables.id, existing.id))
          .run();
        // Trace persistence at the secret boundary — never the value.
        console.log(
          `[project-env] set op=update project=${input.projectId} key=${input.key} protected=${input.isProtected}`
        );
        return { id: existing.id, success: true };
      }

      const id = createId();
      db.insert(projectEnvironmentVariables)
        .values({
          id,
          projectId: input.projectId,
          key: input.key,
          value: storedValue,
          isProtected: input.isProtected
        })
        .run();
      console.log(
        `[project-env] set op=insert project=${input.projectId} key=${input.key} protected=${input.isProtected}`
      );
      return { id, success: true };
    }),

  /** Decrypt and return a single protected value on demand (eye icon). */
  reveal: publicProcedure
    .input(z.object({ projectId: z.string().min(1), id: z.string().min(1) }))
    .query(({ input }) => {
      const db = getDatabase();
      const row = db
        .select()
        .from(projectEnvironmentVariables)
        .where(
          and(eq(projectEnvironmentVariables.id, input.id), eq(projectEnvironmentVariables.projectId, input.projectId))
        )
        .get();

      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment variable not found' });
      }
      if (!row.isProtected) {
        return { value: row.value };
      }
      try {
        return { value: decryptSecret(row.value) };
      } catch (err) {
        console.error('[project-env] reveal decrypt failed', err);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: isSecretEncryptionAvailable() ? 'Failed to decrypt value' : 'OS keychain unavailable on this machine'
        });
      }
    }),

  /** Delete a variable by id. */
  remove: publicProcedure
    .input(z.object({ projectId: z.string().min(1), id: z.string().min(1) }))
    .mutation(({ input }) => {
      const db = getDatabase();
      const res = db
        .delete(projectEnvironmentVariables)
        .where(
          and(eq(projectEnvironmentVariables.id, input.id), eq(projectEnvironmentVariables.projectId, input.projectId))
        )
        .run();
      console.log(`[project-env] remove project=${input.projectId} id=${input.id} deleted=${res.changes}`);
      return { success: true };
    })
});
