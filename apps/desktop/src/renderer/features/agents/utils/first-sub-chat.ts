/**
 * Picks the sub-chat with the earliest `created_at`. Used to decide whether
 * the auto-rename flow should also rename the parent chat (first sub-chat
 * doubles as the parent chat's name).
 */
export function getFirstSubChatId(
  subChats: Array<{ id: string; created_at?: Date | string | null }> | undefined
): string | null {
  if (!subChats?.length) return null;
  const sorted = [...subChats].sort(
    (a, b) =>
      (a.created_at ? new Date(a.created_at).getTime() : 0) - (b.created_at ? new Date(b.created_at).getTime() : 0)
  );
  return sorted[0]?.id ?? null;
}
