type FSWatcher = {
  on(event: string, listener: (arg: unknown) => void): FSWatcher;
  close(): Promise<void>;
};

type StatFn = (path: string) => Promise<{ isDirectory(): boolean }>;

function debounce<T extends (...args: unknown[]) => unknown>(func: T, wait: number): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), wait);
  };
}

export async function watchChangeDir(
  absChangeDir: string,
  onEvent: (event: { exists: boolean }) => void
): Promise<{ close: () => Promise<void> }> {
  const { stat } = (await import('node:fs/promises')) as { stat: StatFn };
  const chokidar = await import('chokidar');

  const changeDirExists = async () => {
    try {
      const st = await stat(absChangeDir);
      return st.isDirectory();
    } catch {
      return false;
    }
  };

  const flush = debounce(async () => {
    onEvent({ exists: await changeDirExists() });
  }, 250);

  const watcher = chokidar.watch(absChangeDir, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 50,
      pollInterval: 25
    },
    depth: 2,
    usePolling: false,
    followSymlinks: false
  }) as FSWatcher;

  watcher.on('add', flush);
  watcher.on('change', flush);
  watcher.on('unlink', flush);
  watcher.on('unlinkDir', flush);
  watcher.on('error', (err) => {
    console.error(`[OpenSpecWatcher] Error: ${absChangeDir}`, err);
  });

  await new Promise<void>((resolve) => {
    watcher.on('ready', () => resolve());
  });
  console.log(`[OpenSpecWatcher] Watching: ${absChangeDir}`);

  return {
    close: async () => {
      await watcher.close();
      console.log(`[OpenSpecWatcher] Disposed: ${absChangeDir}`);
    }
  };
}
