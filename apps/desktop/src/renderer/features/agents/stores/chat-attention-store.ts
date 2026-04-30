import { create } from "zustand"
import { subscribeWithSelector } from "zustand/middleware"

export type AttentionReason = "plan-approval"

interface ChatAttentionState {
  flags: Record<string, AttentionReason | undefined>
  setAttention: (subChatId: string, reason: AttentionReason) => void
  clearAttention: (subChatId: string, reason: AttentionReason) => void
  getAttention: (subChatId: string) => AttentionReason | undefined
}

export const useChatAttentionStore = create<ChatAttentionState>()(
  subscribeWithSelector((set, get) => ({
    flags: {},

    setAttention: (subChatId, reason) => {
      set((state) => ({ flags: { ...state.flags, [subChatId]: reason } }))
    },

    clearAttention: (subChatId, reason) => {
      if (get().flags[subChatId] !== reason) return
      set((state) => {
        const next = { ...state.flags }
        delete next[subChatId]
        return { flags: next }
      })
    },

    getAttention: (subChatId) => get().flags[subChatId],
  }))
)
