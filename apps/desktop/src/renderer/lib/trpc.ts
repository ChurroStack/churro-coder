import { createTRPCReact } from '@trpc/react-query';
import { createTRPCProxyClient } from '@trpc/client';
import { ipcLink } from 'trpc-electron/renderer';
import type { AppRouter } from '../../main/lib/trpc/routers';
import superjson from 'superjson';

/**
 * React hooks for tRPC.
 * The explicit return-type annotation prevents TS from trying to inline
 * deep router-internal types into the declaration file (TS2742 / TS4023 —
 * "the inferred type cannot be named without a reference to …").
 */
export const trpc: ReturnType<typeof createTRPCReact<AppRouter>> = createTRPCReact<AppRouter>();

/**
 * Vanilla client for use outside React components (stores, utilities)
 */
export const trpcClient: ReturnType<typeof createTRPCProxyClient<AppRouter>> = createTRPCProxyClient<AppRouter>({
  links: [ipcLink({ transformer: superjson })]
});
