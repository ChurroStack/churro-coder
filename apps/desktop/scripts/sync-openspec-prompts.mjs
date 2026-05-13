import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const PROMPTS_DIR = path.join(ROOT, 'src', 'prompts', 'openspec');
const UPSTREAM_REF = 'v1.3.1';
const UPSTREAM_RAW_BASE = `https://raw.githubusercontent.com/Fission-AI/OpenSpec/${UPSTREAM_REF}`;
const UPSTREAM_PACKAGE_JSON = `${UPSTREAM_RAW_BASE}/package.json`;

const SOURCES = [
  {
    key: 'apply',
    url: `${UPSTREAM_RAW_BASE}/src/core/templates/workflows/apply-change.ts`,
    marker: 'getOpsxApplyCommandTemplate'
  },
  {
    key: 'archive',
    url: `${UPSTREAM_RAW_BASE}/src/core/templates/workflows/archive-change.ts`,
    marker: 'getOpsxArchiveCommandTemplate'
  },
  {
    key: 'propose',
    url: `${UPSTREAM_RAW_BASE}/src/core/templates/workflows/propose.ts`,
    marker: 'getOpsxProposeCommandTemplate'
  },
  {
    key: 'verify',
    url: `${UPSTREAM_RAW_BASE}/src/core/templates/workflows/verify-change.ts`,
    marker: 'getOpsxVerifyCommandTemplate'
  }
];

function extractPromptContent(source, marker) {
  const fnIndex = source.indexOf(`export function ${marker}`);
  if (fnIndex === -1) {
    throw new Error(`Could not find marker ${marker}`);
  }
  const contentIndex = source.indexOf('content: `', fnIndex);
  if (contentIndex === -1) {
    throw new Error(`Could not find command template content for ${marker}`);
  }

  let i = contentIndex + 'content: `'.length;
  let out = '';
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      const next = source[i + 1];
      if (next === '`') {
        out += '`';
        i += 2;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '`') {
      return out;
    }
    out += ch;
    i += 1;
  }

  throw new Error(`Unterminated template literal for ${marker}`);
}

function splitHeaderAndBody(content) {
  if (!content.startsWith('{#')) {
    throw new Error('Prompt file is missing the required Nunjucks header ledger');
  }
  const end = content.indexOf('#}');
  if (end === -1) {
    throw new Error('Prompt file header ledger is malformed');
  }
  return {
    header: content.slice(0, end + 2),
    body: content.slice(end + 2).replace(/^\s*/, '')
  };
}

function hasManualLedger(header) {
  return /\[manual\]\s+(?!None\.)/i.test(header);
}

async function syncPrompt({ key, url, marker }) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  const upstreamTs = await response.text();
  const upstreamBody = extractPromptContent(upstreamTs, marker).trimEnd() + '\n';

  const targetPath = path.join(PROMPTS_DIR, `${key}.j2`);
  const current = await readFile(targetPath, 'utf8');
  const { header, body } = splitHeaderAndBody(current);

  if (hasManualLedger(header)) {
    const sidecarPath = `${targetPath}.upstream`;
    await writeFile(sidecarPath, upstreamBody, 'utf8');
    console.log(`PENDING MANUAL MERGE ${path.basename(sidecarPath)}`);
    return;
  }

  const localBlocks = Array.from(
    body.matchAll(/\{# LOCAL:[\s\S]*?\{# \/LOCAL #\}|\{# LOCAL:[\s\S]*?#\}/g)
  ).map((match) => match[0]);
  const mergedBody = [upstreamBody.trimEnd(), ...localBlocks].filter(Boolean).join('\n\n') + '\n';
  await writeFile(targetPath, `${header}\n${mergedBody}`, 'utf8');
  console.log(`Synced ${key}.j2`);
}

async function assertUpstreamLicense() {
  const response = await fetch(UPSTREAM_PACKAGE_JSON);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${UPSTREAM_PACKAGE_JSON}: ${response.status}`);
  }

  const pkg = await response.json();
  if (pkg.license !== 'MIT') {
    throw new Error(`OpenSpec upstream license must be MIT before syncing prompts; found ${pkg.license ?? 'missing'}`);
  }
  console.log(`Verified OpenSpec ${UPSTREAM_REF} license: MIT`);
}

await mkdir(PROMPTS_DIR, { recursive: true });
await assertUpstreamLicense();
for (const source of SOURCES) {
  await syncPrompt(source);
}
