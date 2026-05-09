// Re-export shim — this file is kept so existing imports (use-sub-chat-status, etc.) keep working.
// New code should import from './kanban-state-machine' directly.
export type { KanbanStatus as SubChatStatus } from './kanban-state-machine';
export { isSubChatNeedingInput } from './kanban-state-machine';
