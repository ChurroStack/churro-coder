// Patches node-pty's bundled gyp files on Windows so electron-rebuild can run
// on a stock VS Build Tools install.
//
// Two issues are patched:
//
// 1) winpty.gyp invokes `cmd /c "cd shared && GetCommitHash.bat"` (and the same
//    pattern for UpdateGenVersion.bat). On Windows systems where
//    `NoDefaultCurrentDirectoryInExePath=1` is set (default on many Windows 11
//    builds and enterprise images), cmd.exe does NOT search the current
//    directory when resolving executables, so the .bat is "not recognized" and
//    node-gyp aborts. Prefixing with `.\\` makes the path explicit. The double
//    backslash is required because gyp files are evaluated as Python string
//    literals — a lone `\U` would trigger a unicode-escape SyntaxError.
//
// 2) Both winpty.gyp and node-pty's top-level binding.gyp require Spectre-
//    mitigated MSVC runtime libraries (`SpectreMitigation: 'Spectre'`). Those
//    libs are an optional component in the Visual Studio installer that most
//    developer machines don't have, producing MSB8040 errors. Spectre
//    mitigation is a defense-in-depth hardening, not a correctness
//    requirement, so we drop it for local builds. Production release builds
//    should run in CI where the toolchain can be controlled.
//
// No-op on non-Windows platforms (winpty is Windows-only).
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

if (process.platform !== "win32") {
  process.exit(0)
}

const winptyGypPath = join(root, "node_modules/node-pty/deps/winpty/src/winpty.gyp")
const bindingGypPath = join(root, "node_modules/node-pty/binding.gyp")

function patchFile(path, label, transforms) {
  if (!existsSync(path)) {
    console.log(`[patch-node-pty-win] ${label} not found, skipping.`)
    return
  }
  let content = readFileSync(path, "utf8")
  let changed = false
  for (const { name, apply } of transforms) {
    const next = apply(content)
    if (next == null || next === content) {
      console.log(`[patch-node-pty-win] ${label}: ${name} already applied or pattern absent.`)
      continue
    }
    content = next
    changed = true
    console.log(`[patch-node-pty-win] ${label}: applied ${name}.`)
  }
  if (changed) writeFileSync(path, content, "utf8")
}

// Replace every variant we might see (idempotent + recovers from a half-
// applied previous run that wrote a single backslash).
function fixBatPath(content, batName) {
  const good = `cd shared && .\\\\${batName}`
  if (content.includes(good)) return null
  const candidates = [`cd shared && .\\${batName}`, `cd shared && ${batName}`]
  const from = candidates.find((c) => content.includes(c))
  if (!from) return null
  return content.split(from).join(good)
}

// Strip the SpectreMitigation block in any of the forms gyp accepts. We match
// the whole `'msvs_configuration_attributes': { 'SpectreMitigation': '...' },`
// block to avoid leaving dangling braces.
function stripSpectre(content) {
  const pattern = /'msvs_configuration_attributes'\s*:\s*\{\s*'SpectreMitigation'\s*:\s*'Spectre'\s*\}\s*,?\s*\n/g
  if (!pattern.test(content)) return null
  return content.replace(pattern, "")
}

patchFile(winptyGypPath, "winpty.gyp", [
  { name: "GetCommitHash.bat prefix", apply: (c) => fixBatPath(c, "GetCommitHash.bat") },
  { name: "UpdateGenVersion.bat prefix", apply: (c) => fixBatPath(c, "UpdateGenVersion.bat") },
  { name: "strip SpectreMitigation", apply: stripSpectre }
])

patchFile(bindingGypPath, "node-pty binding.gyp", [
  { name: "strip SpectreMitigation", apply: stripSpectre }
])
