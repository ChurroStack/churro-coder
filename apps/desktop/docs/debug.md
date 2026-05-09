# Debug Mode

Detail doc for the Electron desktop app. Index: [../AGENTS.md](../AGENTS.md).

Use a provider-neutral stack. The goal is the same whether the agent is Claude or Codex: launch the Electron app from the active worktree, see main-process and renderer logs in the terminal, drive the UI, take screenshots, and rerun a validation flow after edits.

## Recommended stack

1. `bun run dev` in `apps/desktop`
2. Playwright's Electron support for real app automation
3. The in-app `Browser` capability only for localhost/web content, not for the Electron shell
4. The structured debug log server when you need targeted instrumentation beyond normal console output

Do not make Playwright MCP or browser-only tooling the primary solution for this app. They can help with webviews or a localhost preview, but the app surface is Electron, not a normal browser tab.

## What the app exposes in dev now

- `bun run dev` starts `electron-vite dev`.
- Chromium remote debugging is enabled by default on `http://127.0.0.1:9222` in dev mode.
- Renderer `console.log` / `console.warn` / `console.error` messages are forwarded into the main-process terminal output with a `[RendererConsole]` prefix in dev mode.
- Main-process logs already go to stdout.
- DevTools still open for the first window in dev mode.

Environment switches:

```bash
CHURRO_ELECTRON_REMOTE_DEBUGGING_PORT=9333 bun run dev
CHURRO_ELECTRON_REMOTE_DEBUGGING_PORT=0 bun run dev
CHURRO_FORWARD_RENDERER_CONSOLE=1 bun run dev
```

`CHURRO_ELECTRON_REMOTE_DEBUGGING_PORT=0` disables the CDP port. `CHURRO_FORWARD_RENDERER_CONSOLE=1` forces renderer-console forwarding outside normal dev mode.

## Cross-provider workflow

### 1. Launch the app from the worktree

```bash
cd apps/desktop
bun run dev
```

Watch the terminal for:

- main-process logs like `[Main]`, `[App]`, `[Auth Server]`
- forwarded renderer logs like `[RendererConsole] window=1 level=log ...`

### 2. Drive the real Electron UI

Use Playwright Electron as the primary automation surface. That keeps the validation flow portable across Claude and Codex because both can operate against the same Electron test harness and screenshots.

Recommended install inside `apps/desktop`:

```bash
bun add -d playwright
```

Recommended usage:

- add Electron smoke tests under `apps/desktop/e2e/`
- use them for deterministic post-change validation
- keep the checks short: app boots, workspace opens, target UI action works, expected visible state appears

### 3. Use Browser only where it fits

Use the `Browser` plugin/capability for:

- localhost previews opened by the desktop app
- embedded auth pages
- web-only flows that do not require the Electron chrome or preload bridge

Do not rely on Browser alone to validate Electron-only bugs such as window management, preload wiring, IPC bridges, native dialogs, or desktop layout issues.

## Structured debug logging

When normal console output is too noisy or you need reproducible trace points, use the structured debug logging server. This avoids asking the user to manually copy-paste console output.

Start the server:

```bash
bun packages/debug/src/server.ts &
```

Instrument renderer code (no import needed, fails silently):

```js
fetch('http://localhost:7799/log', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tag: 'TAG', msg: 'MESSAGE', data: {}, ts: Date.now() })
}).catch(() => {});
```

Read logs from `.debug/logs.ndjson`. Each line is a JSON object with `tag`, `msg`, `data`, `ts`.

Clear logs:

```bash
curl -X DELETE http://localhost:7799/logs
```

Workflow: Hypothesize -> instrument -> reproduce -> read logs -> fix with evidence -> verify -> remove instrumentation.

See `packages/debug/INSTRUCTIONS.md` for the full protocol.
