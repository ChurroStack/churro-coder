#!/usr/bin/env bash
# Cross-platform release-build convenience script. Mirrors the `release`
# npm script's chained-command behavior: any failure aborts the run so
# we don't keep going and ship broken artifacts.
#
# NOTE: the claude/codex/openspec CLIs are no longer bundled — the app detects
# and uses the user's PATH-installed copies at runtime, so there is no download
# step here. (`bun run codex:gen-types` is a maintainer-only tool to refresh the
# committed codex app-server schema when bumping the supported codex version.)
set -euo pipefail

bun install
bun run build
bun run package:mac
bun run package:win
bun run package:linux
