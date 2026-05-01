import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(scriptDir, "..", "node_modules", "@mcpc-tech", "acp-ai-provider")

const original = `function formatToolError(toolResult) {
  if (!toolResult || toolResult.length === 0) return "Unknown tool error";
  const parts = [];
  for (const blk of toolResult) {
    if (blk.type === "content") {
      if (blk.content.type === "text") {
        parts.push(blk.content.text);
      }
    }
  }
  return parts.join("\\n");
}`

const patched = `function formatToolError(toolResult) {
  if (!toolResult) return "Unknown tool error";
  if (typeof toolResult === "string") return toolResult;
  if (!Array.isArray(toolResult)) {
    if (typeof toolResult === "object") {
      if (typeof toolResult.message === "string") return toolResult.message;
      if (typeof toolResult.error === "string") return toolResult.error;
      try {
        return JSON.stringify(toolResult);
      } catch {
      }
    }
    return String(toolResult);
  }
  if (toolResult.length === 0) return "Unknown tool error";
  const parts = [];
  for (const blk of toolResult) {
    if (blk.type === "content") {
      if (blk.content.type === "text") {
        parts.push(blk.content.text);
      }
    } else if (blk.type === "text" && typeof blk.text === "string") {
      parts.push(blk.text);
    }
  }
  return parts.join("\\n") || "Unknown tool error";
}`

for (const fileName of ["index.mjs", "index.cjs"]) {
  const filePath = join(packageRoot, fileName)
  const source = readFileSync(filePath, "utf8")
  if (source.includes(patched)) {
    continue
  }
  if (!source.includes(original)) {
    throw new Error(
      `Unable to patch @mcpc-tech/acp-ai-provider ${fileName}: expected formatToolError implementation not found.`,
    )
  }
  writeFileSync(filePath, source.replace(original, patched))
}

console.log("[patch-acp-ai-provider] Patched failed tool result formatting")
