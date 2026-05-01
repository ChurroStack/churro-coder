export type ToolApprovalDecision = {
  approved: boolean
  message?: string
  updatedInput?: unknown
}

type PendingToolApproval = {
  subChatId: string
  resolve: (decision: ToolApprovalDecision) => void
}

export const pendingToolApprovals = new Map<string, PendingToolApproval>()

export const clearPendingApprovals = (message: string, subChatId?: string) => {
  for (const [toolUseId, pending] of pendingToolApprovals) {
    if (subChatId && pending.subChatId !== subChatId) continue
    pending.resolve({ approved: false, message })
    pendingToolApprovals.delete(toolUseId)
  }
}
