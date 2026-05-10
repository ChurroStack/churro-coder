type AppServerTurnWatchState = {
  completed: boolean;
  lastEventAt: number;
};

export function waitForAppServerTurn(params: {
  accumulator: AppServerTurnWatchState;
  getTransportLastActivityAt: () => number;
  signal: AbortSignal;
  idleTimeoutMs: number;
  maxRuntimeMs: number;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      params.signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      resolve();
    };

    params.signal.addEventListener('abort', onAbort, { once: true });
    intervalId = setInterval(() => {
      if (params.accumulator.completed) {
        cleanup();
        resolve();
        return;
      }

      const lastActivity = Math.max(params.accumulator.lastEventAt, params.getTransportLastActivityAt());
      if (Date.now() - lastActivity > params.idleTimeoutMs) {
        cleanup();
        reject(new Error(`Codex app-server stream idle for ${params.idleTimeoutMs / 1000}s`));
        return;
      }

      if (Date.now() - startedAt > params.maxRuntimeMs) {
        cleanup();
        reject(new Error('Codex app-server turn timed out'));
      }
    }, 250);
  });
}
