import { describe, test, expect } from "vitest"
import {
  normalizeCodexToolPart,
  normalizeCodexAssistantMessage,
  normalizeCodexStreamChunk,
} from "./codex-tool-normalizer"

describe("normalizeCodexToolPart — verb mapping", () => {
  test("'Read src/foo.ts' → tool-Read with file_path", () => {
    const part = { type: "tool-Read", toolName: "Read src/foo.ts" }
    const result = normalizeCodexToolPart(part) as any
    expect(result.type).toBe("tool-Read")
    expect(result.input?.file_path).toBe("src/foo.ts")
  })

  test("'Run ./build.sh' → tool-Bash with command", () => {
    const part = { type: "tool-Bash", toolName: "Run ./build.sh" }
    const result = normalizeCodexToolPart(part) as any
    expect(result.type).toBe("tool-Bash")
    expect(result.input?.command).toBe("./build.sh")
  })

  test("non-tool-* type → returned unchanged", () => {
    const part = { type: "text", text: "hello" }
    const result = normalizeCodexToolPart(part)
    expect(result).toBe(part)
  })

  test("non-record input → returned unchanged", () => {
    const result = normalizeCodexToolPart("not-an-object")
    expect(result).toBe("not-an-object")
  })
})

describe("normalizeCodexToolPart — Tool: prefix (ACP / MCP)", () => {
  test("Tool:acp-ai-sdk-tools/PlanWrite → tool-PlanWrite", () => {
    const part = {
      type: "tool-PlanWrite",
      toolName: "Tool:acp-ai-sdk-tools/PlanWrite",
      input: {
        action: "create",
        plan: {
          steps: [{ title: "Step one" }, { title: "Step two" }],
        },
      },
    }
    const result = normalizeCodexToolPart(part) as any
    expect(result.type).toBe("tool-PlanWrite")
    // Steps get auto IDs and pending status
    expect(result.input.plan.steps[0].id).toBe("step-1")
    expect(result.input.plan.steps[0].status).toBe("pending")
    expect(result.input.plan.steps[1].id).toBe("step-2")
  })

  test("Tool:acp-ai-sdk-tools/AskUserQuestion → tool-AskUserQuestion", () => {
    const part = {
      type: "tool-AskUserQuestion",
      toolName: "Tool:acp-ai-sdk-tools/AskUserQuestion",
      input: { questions: [{ question: "What color?" }] },
    }
    const result = normalizeCodexToolPart(part) as any
    expect(result.type).toBe("tool-AskUserQuestion")
  })

  test("Tool:some-server/some-tool → tool-mcp__some-server__some-tool", () => {
    const part = {
      type: "tool-mcp__some-server__some-tool",
      toolName: "Tool:some-server/some-tool",
    }
    const result = normalizeCodexToolPart(part) as any
    expect(result.type).toBe("tool-mcp__some-server__some-tool")
  })
})

describe("normalizeCodexToolPart — ACP wrapper output unwrapping", () => {
  test("AskUserQuestion with structuredContent wrapper → unwrapped to result string", () => {
    const part = {
      type: "tool-AskUserQuestion",
      toolName: "Tool:acp-ai-sdk-tools/AskUserQuestion",
      input: { questions: [] },
      output: {
        structuredContent: { result: "User answered yes" },
      },
    }
    const result = normalizeCodexToolPart(part) as any
    expect(result.output).toBe("User answered yes")
  })
})

describe("normalizeCodexToolPart — idempotence", () => {
  test("already-normalized part → same object reference returned", () => {
    const part = {
      type: "tool-Bash",
      input: { command: "ls" },
      output: { stdout: "file.ts" },
    }
    const first = normalizeCodexToolPart(part)
    const second = normalizeCodexToolPart(first)
    // No changes should occur on second pass
    expect(second).toBe(first)
  })
})

describe("normalizeCodexAssistantMessage", () => {
  test("non-assistant message → returned unchanged", () => {
    const msg = { role: "user", parts: [] }
    const result = normalizeCodexAssistantMessage(msg)
    expect(result).toBe(msg)
  })

  test("assistant message with normalizable part → parts updated", () => {
    const msg = {
      role: "assistant",
      parts: [
        { type: "tool-Bash", toolName: "Run echo hello" },
      ],
    }
    const result = normalizeCodexAssistantMessage(msg) as any
    expect(result).not.toBe(msg)
    expect(result.parts[0].input?.command).toBe("echo hello")
  })

  test("assistant message with no normalizable parts → same reference", () => {
    const msg = {
      role: "assistant",
      parts: [{ type: "text", text: "hello" }],
    }
    const result = normalizeCodexAssistantMessage(msg)
    expect(result).toBe(msg)
  })
})

describe("normalizeCodexStreamChunk", () => {
  test("non-tool-input-start chunk → returned unchanged", () => {
    const chunk = { type: "text-delta", textDelta: "hello" }
    const result = normalizeCodexStreamChunk(chunk)
    expect(result).toBe(chunk)
  })

  test("tool-input-start with 'Run cmd' → canonicalized toolName = Bash", () => {
    const chunk = {
      type: "tool-input-start",
      toolName: "Run ls -la",
      toolCallId: "call-1",
    }
    const result = normalizeCodexStreamChunk(chunk) as any
    expect(result.toolName).toBe("Bash")
  })

  test("tool-input-start with ACP wrapper + inner 'Edit foo.ts' → extracts Edit descriptor", () => {
    const chunk = {
      type: "tool-input-available",
      toolName: "acp.acp_provider_agent_dynamic_tool",
      toolCallId: "call-2",
      input: {
        toolName: "Edit src/index.ts",
        args: { file_path: "src/index.ts" },
      },
    }
    const result = normalizeCodexStreamChunk(chunk) as any
    expect(result.toolName).toBe("Edit")
  })
})

describe("normalizeCodexToolPart — acp-ai-sdk-tools task tools (Tool: prefix path)", () => {
  for (const toolName of [
    "TodoWrite",
    "TaskCreate",
    "TaskUpdate",
    "TaskList",
    "TaskGet",
  ]) {
    test(`Tool:acp-ai-sdk-tools/${toolName} → tool-${toolName}`, () => {
      const part = {
        type: `tool-${toolName}`,
        toolName: `Tool:acp-ai-sdk-tools/${toolName}`,
      }
      const result = normalizeCodexToolPart(part) as any
      expect(result.type).toBe(`tool-${toolName}`)
    })
  }
})

describe("normalizeCodexStreamChunk — mcp__acp-ai-sdk-tools__ task tools", () => {
  for (const toolName of [
    "TodoWrite",
    "TaskCreate",
    "TaskUpdate",
    "TaskList",
    "TaskGet",
  ]) {
    test(`tool-input-start with mcp__acp-ai-sdk-tools__${toolName} → toolName = ${toolName}`, () => {
      const chunk = {
        type: "tool-input-start",
        toolName: `mcp__acp-ai-sdk-tools__${toolName}`,
        toolCallId: "call-task",
      }
      const result = normalizeCodexStreamChunk(chunk) as any
      expect(result.toolName).toBe(toolName)
    })
  }
})
