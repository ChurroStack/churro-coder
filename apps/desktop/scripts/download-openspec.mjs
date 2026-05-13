#!/usr/bin/env node
/**
 * Downloads and installs @fission-ai/openspec for bundling with the Electron app.
 * The package runs via Electron's built-in Node runtime at runtime (ELECTRON_RUN_AS_NODE=1),
 * so no separate Node binary is needed.
 *
 * Usage:
 *   node scripts/download-openspec.mjs                   # Install pinned version
 *   node scripts/download-openspec.mjs --latest          # Fetch latest from npm registry
 *   node scripts/download-openspec.mjs --version=1.4.0   # Specific version
 *
 * Output layout:
 *   resources/openspec/
 *     bin/openspec         ← POSIX shim (already committed, chmod +x)
 *     bin/openspec.cmd     ← Windows shim (already committed)
 *     pkg/                 ← npm package + runtime deps (gitignored)
 *     OPENSPEC_VERSION     ← version marker
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const OPENSPEC_DIR = path.join(ROOT_DIR, 'resources', 'openspec');
const PKG_DIR = path.join(OPENSPEC_DIR, 'pkg');
const BIN_DIR = path.join(OPENSPEC_DIR, 'bin');

const PINNED_VERSION = '1.3.1';
const NPM_PACKAGE = '@fission-ai/openspec';
const NPM_REGISTRY = 'https://registry.npmjs.org';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return fetchJson(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const attempt = (nextUrl) => {
      const file = fs.createWriteStream(destPath);
      https
        .get(nextUrl, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            file.close(() => {
              fs.rmSync(destPath, { force: true });
              attempt(res.headers.location);
            });
            return;
          }
          if (res.statusCode !== 200) {
            file.close();
            fs.rmSync(destPath, { force: true });
            return reject(new Error(`HTTP ${res.statusCode} from ${nextUrl}`));
          }
          const total = Number.parseInt(res.headers['content-length'] || '0', 10);
          let downloaded = 0;
          let lastPct = -1;
          res.on('data', (chunk) => {
            downloaded += chunk.length;
            if (total <= 0) return;
            const pct = Math.floor((downloaded / total) * 100);
            if (pct !== lastPct && pct % 10 === 0) {
              process.stdout.write(`\r  Progress: ${pct}%`);
              lastPct = pct;
            }
          });
          res.pipe(file);
          file.on('finish', () => {
            file.close();
            if (total > 0) process.stdout.write('\r  Progress: 100%\n');
            resolve();
          });
          res.on('error', (err) => {
            file.close();
            fs.rmSync(destPath, { force: true });
            reject(err);
          });
        })
        .on('error', (err) => {
          file.close();
          fs.rmSync(destPath, { force: true });
          reject(err);
        });
    };
    attempt(url);
  });
}

function extractTarGz(archivePath, targetDir) {
  const result = spawnSync('tar', ['-xzf', archivePath, '-C', targetDir], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`tar extraction failed with code ${result.status ?? 'unknown'}`);
  }
}

function npmInstall(dir) {
  // Use npm ci/install to install only production deps for the package.
  // Prefer npm (universally available with Node) over bun for hermeticism.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install', '--omit=dev', '--no-fund', '--no-audit'], {
    cwd: dir,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`npm install failed with code ${result.status ?? 'unknown'}`);
  }
}

function getVersionArg(args) {
  const eq = args.find((a) => a.startsWith('--version='));
  if (eq) return eq.slice('--version='.length);
  const idx = args.indexOf('--version');
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return null;
}

async function getLatestVersion() {
  const meta = await fetchJson(`${NPM_REGISTRY}/${encodeURIComponent(NPM_PACKAGE)}/latest`);
  const version = meta?.version;
  if (!version) throw new Error('Could not determine latest version from npm registry');
  return version;
}

async function getVersionMeta(version) {
  return fetchJson(
    `${NPM_REGISTRY}/${encodeURIComponent(NPM_PACKAGE)}/${encodeURIComponent(version)}`
  );
}

async function main() {
  const args = process.argv.slice(2);
  const useLatest = args.includes('--latest');
  const specifiedVersion = getVersionArg(args);

  console.log('OpenSpec Installer');
  console.log('==================\n');

  const version = specifiedVersion || (useLatest ? await getLatestVersion() : PINNED_VERSION);
  console.log(`Version: ${version}`);

  // Check if already installed at the right version
  const versionFile = path.join(OPENSPEC_DIR, 'OPENSPEC_VERSION');
  if (fs.existsSync(versionFile) && fs.existsSync(PKG_DIR)) {
    const installed = fs.readFileSync(versionFile, 'utf8').split('\n')[0].trim();
    if (installed === version) {
      console.log('Already installed and up-to-date.\n✓ Done');
      return;
    }
    console.log(`Upgrading from ${installed} → ${version}`);
  }

  const meta = await getVersionMeta(version);
  const tarballUrl = meta?.dist?.tarball;
  if (!tarballUrl) throw new Error(`No tarball URL found in npm metadata for ${version}`);
  const integrity = meta?.dist?.integrity || null;

  console.log(`\nDownloading ${NPM_PACKAGE}@${version}...`);
  console.log(`  URL: ${tarballUrl}`);

  fs.mkdirSync(OPENSPEC_DIR, { recursive: true });

  const tmpTarball = path.join(OPENSPEC_DIR, `openspec-${version}.tgz.download`);
  const extractDir = path.join(OPENSPEC_DIR, '.extract');

  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(tmpTarball, { force: true });

  await downloadFile(tarballUrl, tmpTarball);

  console.log('\nExtracting...');
  fs.mkdirSync(extractDir, { recursive: true });
  extractTarGz(tmpTarball, extractDir);
  fs.rmSync(tmpTarball, { force: true });

  // npm tarballs always extract to a "package/" subdirectory
  const extractedPkg = path.join(extractDir, 'package');
  if (!fs.existsSync(extractedPkg)) {
    throw new Error(`Expected "package/" inside tarball but not found in ${extractDir}`);
  }

  console.log('Installing production dependencies...');
  npmInstall(extractedPkg);

  // Atomically replace pkg dir
  const trashDir = path.join(OPENSPEC_DIR, '.pkg.trash');
  fs.rmSync(trashDir, { recursive: true, force: true });
  if (fs.existsSync(PKG_DIR)) {
    fs.renameSync(PKG_DIR, trashDir);
  }
  fs.renameSync(extractedPkg, PKG_DIR);
  fs.rmSync(trashDir, { recursive: true, force: true });
  fs.rmSync(extractDir, { recursive: true, force: true });

  // Ensure shims are executable (they're committed but chmod may be lost on some checkouts)
  const shimPath = path.join(BIN_DIR, 'openspec');
  if (fs.existsSync(shimPath)) {
    fs.chmodSync(shimPath, 0o755);
  }

  // Write version marker
  fs.writeFileSync(versionFile, `${version}\n${new Date().toISOString()}\n`);

  // Verify the entry point exists
  const entryJs = path.join(PKG_DIR, 'bin', 'openspec.js');
  if (!fs.existsSync(entryJs)) {
    throw new Error(`Entry point not found after install: ${entryJs}`);
  }

  console.log(`\n✓ @fission-ai/openspec@${version} installed to resources/openspec/pkg/`);
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
