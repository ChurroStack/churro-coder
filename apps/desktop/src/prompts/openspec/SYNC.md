# OpenSpec Prompt Sync

These prompts are vendored from upstream OpenSpec workflow templates and adapted for Churro Coder's OpenSpec sidebar flow.

Pinned upstream: `Fission-AI/OpenSpec@v1.3.1`. The sync script verifies the upstream `package.json` license is `MIT` before writing any prompt files.

Current files:

- `apply.j2` ← `src/core/templates/workflows/apply-change.ts` / `getOpsxApplyCommandTemplate().content`
- `archive.j2` ← `src/core/templates/workflows/archive-change.ts` / `getOpsxArchiveCommandTemplate().content`
- `propose.j2` ← `src/core/templates/workflows/propose.ts` / `getOpsxProposeCommandTemplate().content`
- `verify.j2` ← `src/core/templates/workflows/verify-change.ts` / `getOpsxVerifyCommandTemplate().content`
- `system.j2` ← Churro Coder original composition

Local modification rules:

1. Record every change in the top Nunjucks comment block of the affected prompt.
2. Prefer `{# LOCAL: ... #}` blocks for changes that should survive automated sync.
3. If a change cannot be isolated in a `{# LOCAL: ... #}` block, mark it as `manual` in the ledger.
4. `system.j2` is app-owned and should not be overwritten from upstream.

Sync flow:

1. Run `bun run sync:openspec`.
2. If the script writes a `*.upstream` sidecar, a manual merge is required.
3. Re-apply any `manual` ledger entries.
4. Keep `{# LOCAL: ... #}` blocks intact.
5. Re-run the relevant desktop tests.

## Upgrading the bundled CLI

The vendored prompts and the bundled `@fission-ai/openspec` CLI are pinned together. When upgrading:

1. Edit **two** constants to the new version:
   - `PINNED_VERSION` in `apps/desktop/scripts/download-openspec.mjs`
   - `UPSTREAM_REF` in `apps/desktop/scripts/sync-openspec-prompts.mjs`
2. Run:
   ```bash
   bun run openspec:install   # refreshes resources/openspec/pkg/
   bun run sync:openspec      # refreshes src/prompts/openspec/*.j2
   ```
3. Resolve any `*.upstream` sidecars (manual merge required when local blocks can't auto-merge).
4. Smoke-test the four slash commands (`/opsx:propose`, `/opsx:apply`, `/opsx:archive`, `/opsx:verify`) in a dev build.
5. Commit both constant bumps, the re-synced `.j2` files, and the updated `OPENSPEC_VERSION` in one PR.
