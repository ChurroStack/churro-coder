import { describe, test, expect } from "vitest"
import { deriveWorkspaceStatus, isSubChatNeedingInput } from "./derive-status"

describe("deriveWorkspaceStatus", () => {
  test("pending question → needs-input (highest priority)", () => {
    const status = deriveWorkspaceStatus("chat-1", {
      workspacesLoading: new Set(["chat-1"]),
      workspacesWithPendingQuestions: new Set(["chat-1"]),
      workspacesWithPendingApprovals: new Set(),
    })
    expect(status).toBe("needs-input")
  })

  test("pending plan approval → needs-input", () => {
    const status = deriveWorkspaceStatus("chat-1", {
      workspacesLoading: new Set(),
      workspacesWithPendingQuestions: new Set(),
      workspacesWithPendingApprovals: new Set(["chat-1"]),
    })
    expect(status).toBe("needs-input")
  })

  test("loading only → in-progress", () => {
    const status = deriveWorkspaceStatus("chat-1", {
      workspacesLoading: new Set(["chat-1"]),
      workspacesWithPendingQuestions: new Set(),
      workspacesWithPendingApprovals: new Set(),
    })
    expect(status).toBe("in-progress")
  })

  test("nothing active → done", () => {
    const status = deriveWorkspaceStatus("chat-1", {
      workspacesLoading: new Set(),
      workspacesWithPendingQuestions: new Set(),
      workspacesWithPendingApprovals: new Set(),
    })
    expect(status).toBe("done")
  })

  test("different chatId → not affected by other workspace state", () => {
    const status = deriveWorkspaceStatus("chat-2", {
      workspacesLoading: new Set(["chat-1"]),
      workspacesWithPendingQuestions: new Set(["chat-1"]),
      workspacesWithPendingApprovals: new Set(),
    })
    expect(status).toBe("done")
  })
})

describe("isSubChatNeedingInput", () => {
  test("pending question → true", () => {
    expect(
      isSubChatNeedingInput("sub-1", {
        subChatsWithPendingQuestions: new Set(["sub-1"]),
        subChatsWithPendingPlanApprovals: new Set(),
      }),
    ).toBe(true)
  })

  test("pending plan approval → true", () => {
    expect(
      isSubChatNeedingInput("sub-1", {
        subChatsWithPendingQuestions: new Set(),
        subChatsWithPendingPlanApprovals: new Set(["sub-1"]),
      }),
    ).toBe(true)
  })

  test("neither pending → false", () => {
    expect(
      isSubChatNeedingInput("sub-1", {
        subChatsWithPendingQuestions: new Set(),
        subChatsWithPendingPlanApprovals: new Set(),
      }),
    ).toBe(false)
  })
})
