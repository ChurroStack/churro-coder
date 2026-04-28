#!/usr/bin/env bash
# Cross-platform release-build convenience script. Mirrors the `release`
# npm script's chained-command behavior: any failure aborts the run so
# we don't keep going and ship broken artifacts (e.g. a packaged app
# missing the Claude / Codex binaries because their download step
# rate-limited).
set -euo pipefail

bun install
bun run claude:download  # Download Claude binary (required!)
bun run codex:download   # Download Codex binary (required!)
bun run build
bun run package:mac
bun run package:win
bun run package:linux
