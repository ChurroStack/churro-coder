# Releasing a New Version

Detail doc for the Electron desktop app. Index: [../AGENTS.md](../AGENTS.md).

## Automated releases (GitHub Actions + release-please)

This is the primary, public release path. Installers for **macOS, Windows, and Linux** are built on
GitHub-hosted runners and attached to a **GitHub Release** so anyone can download them.

How it works (see [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) and the
root [`README.md`](../../../README.md#downloads--releases)):

1. Conventional commits (`feat:`, `fix:`, …) land on `main`. release-please attributes any commit that
   touches `apps/desktop/**` to the desktop package.
2. On each push to `main`, [release-please](https://github.com/googleapis/release-please) opens/updates
   a **release PR** that bumps `apps/desktop/package.json` and updates `apps/desktop/CHANGELOG.md`.
3. **Merging that release PR** creates the GitHub Release + a `v<version>` tag, and triggers the
   `build` job: a per-OS matrix (`macos-latest` / `windows-latest` / `ubuntu-latest`) that runs
   `bun install` → `claude:download` + `codex:download` → `bun run build` → `bun run package:<platform>`,
   then `gh release upload`s the artifacts. **Nothing is built on ordinary PRs.**

Per platform the Release gets: macOS `.dmg` + `.zip` (arm64 & x64), Windows NSIS `.exe` + portable
`.exe`, Linux `.AppImage` + `.deb`.

### Versioning / first release
- Config: [`release-please-config.json`](../../../release-please-config.json) +
  [`.release-please-manifest.json`](../../../.release-please-manifest.json) (a single `node` package at
  `apps/desktop`, plain `v<version>` tags).
- The manifest baseline is `0.0.0`. To cut the **first** release as exactly `0.1.0`, push a one-shot
  empty commit with a `Release-As` footer (no persistent config to forget) — ideally as the first
  commit after this pipeline lands, before any other `feat:`/`fix:`:
  ```bash
  git commit --allow-empty -m "chore: bootstrap desktop release 0.1.0" -m "Release-As: 0.1.0"
  ```
- After that, the `bump-minor-pre-major` + `bump-patch-for-minor-pre-major` config flags keep the 0.x
  series conservative: while the version is `< 1.0.0`, both `feat:` and `fix:` bump the **patch**
  (`0.1.0` → `0.1.1`) and breaking changes bump the **minor** (`0.1.0` → `0.2.0`). Nothing auto-jumps
  to `1.0.0` — promote to a stable `1.0.0` deliberately with a one-shot `Release-As: 1.0.0` footer
  when you're ready.

### macOS signing (currently OFF) and one-time repo setup
The macOS build ships **unsigned** today; the workflow's signing + notarization steps stay inert until
the Apple secrets are added. The exact secret list and where to add them is documented in
[`README.md` → Enabling macOS code signing & notarization](../../../README.md#enabling-macos-code-signing--notarization).
One-time: enable **Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to
create and approve pull requests"** so release-please can open its PR.

---

## Manual / CDN release (signed auto-update channel)

The steps below are the original maintainer flow used to ship **signed** macOS builds to the in-app
auto-updater's CDN (`cdn.churrostack.com`). This is independent of the GitHub Releases flow above.

## Prerequisites for Notarization

- Keychain profile: `churrostack-notarize`
- Create with: `xcrun notarytool store-credentials "churrostack-notarize" --apple-id YOUR_APPLE_ID --team-id YOUR_TEAM_ID`

## Release Commands

```bash
# Step by step:
bun run build              # Compile TypeScript
bun run package:mac        # Build & sign macOS app (produces DMGs in release/)
```

## Bump Version Before Release

```bash
npm version patch --no-git-tag-version  # 0.0.27 → 0.0.28
```

## After Package Completes

1. Wait for notarization (2-5 min): `xcrun notarytool history --keychain-profile "churrostack-notarize"`
2. Staple DMGs: `cd release && xcrun stapler staple *.dmg`
3. Distribute DMGs manually or via the CDN release flow (`bun run release`).

## Auto-update

Auto-update is wired up via `electron-builder`'s `generic` provider:
- `electron-builder.yml` / `package.json#build.publish.url` points at `https://cdn.churrostack.com/releases/desktop`.
- `bun run dist:manifest` (`scripts/generate-update-manifest.mjs`) produces the latest-mac/win/linux YAML manifests.
- `bun run dist:upload` (or `scripts/upload-release-wrangler.sh`) pushes artifacts + manifests to the CDN bucket.
- The renderer-side updater lives at `src/main/lib/auto-updater.ts`.

The `release` script chains `build → package:mac → dist:manifest → upload-release-wrangler.sh` so a normal release is one command.
