# Agent Prompts

Detail doc for the Electron desktop app. Index: [../AGENTS.md](../AGENTS.md).

## Invariant: prompts live in `.j2` files, not in source code

**Every prompt sent to a coding agent (Claude / Codex / Ollama) is a Jinja-style template under `src/prompts/`, not an inline string in TypeScript.** This includes slash-command prompts, workflow messages (PR, review, merge), Codex mode instructions, builtin-subagent system prompts, automation templates, and commit-message generators.

If you find yourself writing a string literal or template literal that will be sent verbatim to an LLM, stop and add a template instead. The point of this invariant is that prompts are user-customizable per project (via `.cscode/worktree.json`'s `prompts` field), greppable in one place, and locked to fixture tests for the complex ones.

## Layout

```
src/prompts/
├── index.ts                 # BUILTIN_PROMPTS via import.meta.glob (eager, build-time bundled)
├── render.ts                # renderTemplate / renderBuiltinPrompt (Nunjucks env)
├── mode/                    # Codex mode instructions (plan / execute / explore / codex-approved-plan-hint)
├── slash/                   # Slash-command prompts (/review, /init, /worktree-setup, ...)
├── workflow/                # PR / review / merge / fix-conflicts / implement-plan
├── commit-message/          # Claude / Ollama × {full, description-only}
├── subagent/                # Built-in subagent system prompts (Explore, Plan, general-purpose, ...)
└── automation/              # Automation template instructions (5 templates)
```

Key derivation: relative path minus `.j2`. So `src/prompts/slash/review.j2` → key `slash/review`.

## Adding a new prompt

1. **Pick the namespace** from the list above. If none fits, add a new directory (kebab-case) and update this doc.
2. **Create the `.j2` file** with the prompt text. Use `{{ var }}` for variable substitution and `{% if %}` / `{% set %}` / `{% for %}` for conditionals — Nunjucks 3.x semantics (note: `{% set %}` inside `{% if %}` *does* propagate to the outer scope, unlike Jinja2).
3. **Render it from the call site:**
   - **Main process:** `await getPrompt({ key: 'namespace/name', vars, projectPath })` from `src/main/lib/prompts/prompt-service.ts`. `projectPath` enables user-override lookup; pass `undefined` when not project-scoped.
   - **Renderer process:** for static prompts or those that don't need user-override, `renderBuiltinPrompt('namespace/name', vars)` from `src/prompts/render.ts`. For prompts where you want per-project overrides, `await trpcClient.prompts.get.query({ projectId, key, vars })`.
4. **Lock complex templates with fixture tests** under `src/prompts/<name>.test.ts`. Read the `.j2` file with `fs.readFileSync(resolve(__dirname, ...))`, render with a fresh Nunjucks Environment, assert exact-match against inline expected strings. See `src/prompts/create-pr.test.ts` for the matrix-style pattern (one fixture per branch combination).

## User overrides

Users can override any prompt key from `.cscode/worktree.json`:

```json
{
  "prompts": {
    "slash/review": "Review only TypeScript files in src/, ignore tests.",
    "workflow/create-pr": "Branch: {{ branch }} → {{ baseBranch }}. Use conventional commits."
  }
}
```

Empty string / whitespace-only / non-string / malformed → `[PromptService]` warn + fall back to builtin. The same Nunjucks engine and variables are available in user templates.

## Gotchas

- **Trailing newline**: `.j2` files end with a newline (POSIX), so rendered output has a trailing `\n` that the legacy inline-string code did not. For LLM prompts this is harmless. If you need byte-identical output, `.trimEnd()` at the call site or use `{%- -%}` whitespace control in the template.
- **`throwOnUndefined: true`**: A missing variable throws at render time. Pass every variable the template references, even if empty (`''` / `null`).
- **`autoescape: false`**: Output is plain text, not HTML. Don't reuse this Nunjucks env for HTML rendering.
- **`import.meta.glob` is Vite-only**: Tests that import from `src/prompts/index.ts` must mock it (`vi.mock('../../../prompts/index', ...)`) or read `.j2` files directly with `fs.readFileSync`. See `src/main/lib/prompts/prompt-service.test.ts` (mock pattern) and `src/prompts/create-pr.test.ts` (direct-read pattern).
- **`nunjucks` is bundled, not externalized**: `electron.vite.config.ts`'s main `externalizeDepsPlugin.exclude` lists `"nunjucks"`. Don't remove it.
