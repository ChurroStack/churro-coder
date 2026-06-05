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
   `bun install` → `bun run build` → `bun run package:<platform>`, then `gh release upload`s the
   artifacts. **Nothing is built on ordinary PRs.** (The claude/codex/openspec CLIs are no longer
   bundled — the app uses the user's PATH-installed copies at runtime.)

Per platform the Release gets: macOS `.dmg` + `.zip` (**arm64 only** — see signing note below),
Windows NSIS `.exe` + portable `.exe`, Linux `.AppImage` + `.deb`.

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

### macOS: arm64-only, ad-hoc signed (currently no Developer ID)
The CI mac build is **arm64-only** and **ad-hoc signed**, deferring real Developer ID signing +
notarization and Intel/x64 support:
- **arm64-only** because the runner is Apple Silicon (`macos-latest`). A faithful x64 build can't be
  produced there — `node-pty` would have to cross-compile and bun only installs the arm64
  `@anthropic-ai/claude-agent-sdk-darwin-arm64` optional dep (the x64 variant is absent, so an x64
  artifact would silently ship broken). To restore Intel later, re-add `x64` to `mac.target` in
  `package.json` **and** build it on a dedicated Intel/x64 leg (`macos-13`, or arch-specific installs).
- **ad-hoc signed** because arm64 apps must carry *some* signature to launch. `mac.identity` is left
  undefined, so electron-builder ad-hoc-falls-back automatically; the workflow unsets an empty
  `CSC_LINK` so packaging doesn't try to import a non-existent cert. Ad-hoc still does **not** pass
  Gatekeeper/notarization, so users need a one-time bypass (right-click → Open, or
  `xattr -dr com.apple.quarantine <app>`).
- **Enabling real signing later needs no config edit:** add the Apple secrets (a non-empty `CSC_LINK`
  flows through and is auto-discovered; `notarize: false` in `package.json` keeps the explicit Notarize
  workflow step the single notarizer). Secret list and where to add them:
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
