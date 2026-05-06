import { initTRPC } from '@trpc/server';
import type { BrowserWindow } from 'electron';
import superjson from 'superjson';
import { captureError, redactUnknown } from '../analytics';

const CLIENT_ERROR_CODES = new Set([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PRECONDITION_FAILED'
]);

export function shouldCaptureTrpcErrorCode(code: string | undefined): boolean {
  return !code || !CLIENT_ERROR_CODES.has(code);
}

export function reportTrpcError(args: {
  code: string | undefined;
  error: { cause?: unknown } & Error;
  path: string | undefined;
  type: string;
  input: unknown;
}): void {
  if (!shouldCaptureTrpcErrorCode(args.code)) return;

  captureError(args.error.cause ?? args.error, {
    trpcPath: args.path,
    trpcType: args.type,
    code: args.code,
    input: redactUnknown(args.input)
  });
}

/**
 * Context passed to all tRPC procedures
 */
export interface Context {
  getWindow: () => BrowserWindow | null;
}

/**
 * Initialize tRPC with context and superjson transformer
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error, path, type, input }) {
    reportTrpcError({ code: shape.data.code, error, path, type, input });

    return {
      ...shape,
      data: {
        ...shape.data,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    };
  }
});

/**
 * Export reusable router and procedure helpers
 */
export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

/**
 * Middleware to log procedure calls
 */
export const loggerMiddleware = middleware(async ({ path, type, next }) => {
  const start = Date.now();
  const result = await next();
  const duration = Date.now() - start;
  console.log(`[tRPC] ${type} ${path} - ${duration}ms`);
  return result;
});

/**
 * Procedure with logging
 */
export const loggedProcedure = publicProcedure.use(loggerMiddleware);
