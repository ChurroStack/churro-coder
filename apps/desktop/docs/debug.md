# Debug Mode

Detail doc for the Electron desktop app. Index: [../AGENTS.md](../AGENTS.md).

Use a provider-neutral stack. The goal is the same whether the agent is Claude or Codex: launch the Electron app from the active worktree, see main-process and renderer logs in the terminal, drive the UI, take screenshots, and rerun a validation flow after edits.

## Recommended stack

1. `bun run dev:debug` in `apps/desktop` (or plain `bun run dev` if you do not need agent UI driving)
2. The repo-registered `playwright` MCP server (drives the renderer over CDP) for ad-hoc UI clicks, snapshots, screenshots, and `evaluate`
3. Playwright's Electron support (`_electron.launch`) when you need to write a repeatable spec that also spans main-process behavior or multi-window flows
4. The structured debug log server when you need targeted instrumentation beyond normal console output

The Browser plugin / capability is for localhost-only or webview content — it does not see the Electron shell, so do not rely on it alone to validate Electron-only bugs (window management, preload, IPC, native dialogs).

## What the app exposes in dev

- `bun run dev` starts `electron-vite dev`. CDP is **off** by default — leaving it on would let any local process attach and run JS in the renderer (and from there reach the IPC handlers).
- `bun run dev:debug` is the same thing with `CHURRO_ELECTRON_REMOTE_DEBUGGING_PORT=1`, exposing Chromium remote debugging on `http://127.0.0.1:9222`.
- Renderer `console.*` messages are forwarded into the main-process terminal output with a `[RendererConsole]` prefix in any non-packaged build (`window=<id> level=<debug|log|warn|error> source=<url>:<line>`).
- Main-process logs already go to stdout.
- DevTools still open for the first window in dev mode.

Environment switches:

```bash
CHURRO_ELECTRON_REMOTE_DEBUGGING_PORT=1     bun run dev   # default port 9222
CHURRO_ELECTRON_REMOTE_DEBUGGING_PORT=9333  bun run dev   # custom port
CHURRO_ELECTRON_REMOTE_DEBUGGING_PORT=0     bun run dev   # explicit off (same as unset)
CHURRO_FORWARD_RENDERER_CONSOLE=1           bun run dev   # force renderer-console forwarding in packaged builds
```

Invalid values (non-integer, port out of 1..65535) are rejected with a `[DevTools] Ignoring invalid …` warning at startup.

## Cross-provider workflow

### 1. Launch the app from the worktree

```bash
cd apps/desktop
bun run dev:debug
```

Watch the terminal for:

- main-process logs like `[Main]`, `[App]`, `[Auth Server]`
- forwarded renderer logs like `[RendererConsole] window=1 level=log source=…`
- the startup line `[DevTools] Chromium remote debugging enabled on http://127.0.0.1:9222`

Sanity check the CDP endpoint from another shell:

```bash
curl -s http://127.0.0.1:9222/json/version | head
```

### 2. Drive the UI from your agent

Both Claude Code (via repo-root `.mcp.json`) and Codex (via `.codex/config.toml`, falling back to `~/.codex/config.toml` on older Codex versions) get a `playwright` MCP server registered for this repo. It launches `npx -y @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:9222`, attaching to the running Electron renderer.

From the agent loop you can then:

- `browser_snapshot` — accessibility-tree snapshot of the renderer (preferred over screenshots for clicking decisions)
- `browser_click` / `browser_type` / `browser_select_option` — drive the UI
- `browser_evaluate` — run JS inside the renderer (useful for reading jotai/zustand state)
- `browser_take_screenshot` — capture evidence for the PR description
- `browser_console_messages` / `browser_network_requests` — observe in-flight behavior

The first run may download Chromium for Playwright if no compatible browser is cached. If you see a Playwright "browsers are not installed" error, run `npx playwright install chromium` once.

### 3. When to write a Playwright Electron spec instead

For repeatable post-change validation (regression coverage, multi-window orchestration, anything that needs to assert main-process side effects), add a spec under `apps/desktop/e2e/` using Playwright's Electron support:

```bash
cd apps/desktop
bun add -d playwright
npx playwright install chromium
```

Use `_electron.launch({ args: ['.'] })` to launch the real built app — that gives you the main process, all `BrowserWindow`s, and the preload bridge in scope, which CDP attach alone does not. Keep specs short (boots → opens workspace → exercises one path → asserts visible state) and check them in next to the feature they cover.

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
