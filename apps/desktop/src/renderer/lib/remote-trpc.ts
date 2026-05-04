/**
 * tRPC client for remote web backend (legacy; remote calls are disabled).
 *
 * The `web/server/api/root` module was removed when the remote web backend
 * was retired. The renderer still imports `remoteTrpc` from a few legacy
 * call sites; we expose `remoteTrpc` as `any` so they keep compiling.
 * The procedures throw at runtime (signedFetch hits a stub URL).
 */
import { createTRPCClient, httpLink } from '@trpc/client';
import SuperJSON from 'superjson';

// AppRouter type intentionally typed as `any` — the real backend type
// `web/server/api/root` is no longer part of this checkout.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AppRouter = any;

// Placeholder URL - actual base is fetched dynamically from main process
const TRPC_PLACEHOLDER = '/__dynamic__/api/trpc';

// Cache the API base URL after first fetch
let cachedApiBase: string | null = null;

async function getApiBase(): Promise<string> {
  if (!cachedApiBase) {
    cachedApiBase = (await window.desktopApi?.getApiBaseUrl()) || '';
  }
  return cachedApiBase;
}

/**
 * Custom fetch that goes through Electron IPC
 * Automatically adds auth token and bypasses CORS
 * Replaces placeholder URL with actual API base from env
 */
const signedFetch: typeof fetch = async (input, init) => {
  if (typeof window === 'undefined' || !window.desktopApi?.signedFetch) {
    throw new Error('Desktop API not available');
  }

  let url = typeof input === 'string' ? input : input.toString();

  // Replace placeholder with actual API base
  if (url.startsWith('/__dynamic__')) {
    const apiBase = await getApiBase();
    url = url.replace('/__dynamic__', apiBase);
  }

  const result = await window.desktopApi.signedFetch(url, {
    method: init?.method,
    body: init?.body as string | undefined,
    headers: init?.headers as Record<string, string> | undefined
  });

  // Convert IPC result to Response-like object
  return {
    ok: result.ok,
    status: result.status,
    json: async () => result.data,
    text: async () => JSON.stringify(result.data)
  } as Response;
};

/**
 * tRPC client connected to web backend.
 * Typed as `any` because the real `AppRouter` type from `web/server/api/root`
 * was removed when the remote backend was retired. Legacy call sites keep
 * compiling; they throw at runtime via `signedFetch`'s stub URL.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const remoteTrpc: any = createTRPCClient<AppRouter>({
  links: [
    httpLink({
      url: TRPC_PLACEHOLDER,
      fetch: signedFetch,
      transformer: SuperJSON
    })
  ]
});
