// React Query cache contract (see apps/desktop/AGENTS.md → Query cache contract):
// the renderer process intentionally does NOT persist React Query state across
// app sessions — every cold start gets a fresh QueryClient via the
// `useState(() => new QueryClient(...))` below. Per-subChat / per-worktree
// data refreshes naturally on remount, and explicit `invalidateQueries`
// covers in-session server-side mutations. Do NOT introduce `persistQueryClient`:
// it would resurrect stale state from a prior process lifetime, which can
// surface as "the subChat panel shows old plan / review / file-changes data
// even though the server-side artifacts have moved on".
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ipcLink } from 'trpc-electron/renderer';
import { trpc } from '../lib/trpc';
import superjson from 'superjson';

interface TRPCProviderProps {
  children: React.ReactNode;
}

// Global query client instance for use outside React components
let globalQueryClient: QueryClient | null = null;

export function getQueryClient(): QueryClient | null {
  return globalQueryClient;
}

export function TRPCProvider({ children }: TRPCProviderProps) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 5000,
          gcTime: 60_000,
          refetchOnWindowFocus: false,
          networkMode: 'always',
          retry: false
        },
        mutations: {
          networkMode: 'always',
          retry: false
        }
      }
    });
    globalQueryClient = client;
    (window as unknown as { __qc: QueryClient }).__qc = client;
    return client;
  });

  const [trpcClient] = useState(() => {
    const client = trpc.createClient({
      links: [ipcLink({ transformer: superjson })]
    });
    return client;
  });

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
