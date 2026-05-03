// Patches @radix-ui/react-slot to stabilize the composed ref inside SlotClone.
//
// Root cause: SlotClone called composeRefs(forwardedRef, childrenRef) directly during
// render, producing a NEW function every render. React 19 treats a changed ref callback
// as a ref update — calling cleanup (ref(null)) then setup (ref(node)) — which causes
// rapid state updates when the component re-renders during atom cascades. This floods
// React's 50-update guard and crashes with "Maximum update depth exceeded".
//
// Fix: wrap the composedRef with React.useCallback so the identity is stable unless
// forwardedRef or childrenRef actually changes. This is exactly what useComposedRefs
// (from @radix-ui/react-compose-refs) does, applied inside SlotClone.
//
// IMPORTANT: bun (and pnpm) hoist most copies of a package, but Radix UI packages
// frequently ship their own nested copy of @radix-ui/react-slot under
// node_modules/@radix-ui/<pkg>/node_modules/@radix-ui/react-slot. Each of those is
// the actual module imported by that parent package, so we patch every copy we find.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

const MJS_TARGET = "    if (React.isValidElement(children)) {\n      const childrenRef = getElementRef(children);\n      const props2 = mergeProps(slotProps, children.props);\n      if (children.type !== React.Fragment) {\n        props2.ref = forwardedRef ? composeRefs(forwardedRef, childrenRef) : childrenRef;"
const MJS_REPLACEMENT = "    const childrenRef = React.isValidElement(children) ? getElementRef(children) : null;\n    const composedRef = React.useCallback(composeRefs(forwardedRef, childrenRef), [forwardedRef, childrenRef]);\n    if (React.isValidElement(children)) {\n      const props2 = mergeProps(slotProps, children.props);\n      if (children.type !== React.Fragment) {\n        props2.ref = forwardedRef ? composedRef : childrenRef;"

const CJS_TARGET = "    if (React.isValidElement(children)) {\n      const childrenRef = getElementRef(children);\n      const props2 = mergeProps(slotProps, children.props);\n      if (children.type !== React.Fragment) {\n        props2.ref = forwardedRef ? (0, import_react_compose_refs.composeRefs)(forwardedRef, childrenRef) : childrenRef;"
const CJS_REPLACEMENT = "    const childrenRef = React.isValidElement(children) ? getElementRef(children) : null;\n    const composedRef = React.useCallback((0, import_react_compose_refs.composeRefs)(forwardedRef, childrenRef), [forwardedRef, childrenRef]);\n    if (React.isValidElement(children)) {\n      const props2 = mergeProps(slotProps, children.props);\n      if (children.type !== React.Fragment) {\n        props2.ref = forwardedRef ? composedRef : childrenRef;"

// Recursively find every dist/index.mjs and dist/index.js under any
// @radix-ui/react-slot package nested anywhere inside node_modules.
function findSlotCopies(startDir) {
  const results = []
  if (!existsSync(startDir)) return results

  function walk(dir) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (!entry.isDirectory()) continue

      // If this directory IS a react-slot package, record its dist files.
      if (entry.name === "react-slot") {
        const parentName = dir.endsWith("/@radix-ui") ? "@radix-ui" : ""
        if (parentName === "@radix-ui") {
          const distMjs = join(fullPath, "dist/index.mjs")
          const distJs = join(fullPath, "dist/index.js")
          if (existsSync(distMjs)) results.push(distMjs)
          if (existsSync(distJs)) results.push(distJs)
        }
      }

      // Recurse into nested node_modules but skip dist/ to avoid scanning bundles.
      if (entry.name === "dist") continue
      walk(fullPath)
    }
  }

  walk(startDir)
  return results
}

const startDir = join(root, "node_modules")
const files = findSlotCopies(startDir)

if (files.length === 0) {
  console.log("[patch-radix-slot] No @radix-ui/react-slot copies found.")
  process.exit(0)
}

let anyPatched = false
let alreadyPatched = 0
let skipped = 0

for (const filePath of files) {
  let content = readFileSync(filePath, "utf8")

  if (content.includes("composedRef = React.useCallback")) {
    alreadyPatched++
    continue
  }

  const isCjs = filePath.endsWith(".js")
  const target = isCjs ? CJS_TARGET : MJS_TARGET
  const replacement = isCjs ? CJS_REPLACEMENT : MJS_REPLACEMENT

  if (!content.includes(target)) {
    console.warn(`[patch-radix-slot] Could not find patch target in: ${filePath}`)
    skipped++
    continue
  }

  content = content.replace(target, replacement)
  writeFileSync(filePath, content, "utf8")
  console.log(`[patch-radix-slot] Patched: ${filePath.replace(root + "/", "")}`)
  anyPatched = true
}

console.log(
  `[patch-radix-slot] Done. patched=${files.length - alreadyPatched - skipped} ` +
  `already=${alreadyPatched} skipped=${skipped} total=${files.length}`,
)

if (anyPatched) {
  console.log("[patch-radix-slot] Delete node_modules/.vite/deps to force Vite to re-bundle.")
}
