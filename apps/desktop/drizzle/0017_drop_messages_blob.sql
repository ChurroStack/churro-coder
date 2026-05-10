-- Backfill any sub_chats that the TypeScript startup backfill didn't reach.
-- Uses SQLite json_each() so no TypeScript code is needed here.
-- Large parts are NOT spilled in this path — they stay inline for migrated rows.
INSERT OR IGNORE INTO messages (sub_chat_id, idx, id, role, parts, metadata, created_at)
SELECT
  sc.id,
  CAST(je.key AS INTEGER),
  json_extract(je.value, '$.id'),
  json_extract(je.value, '$.role'),
  COALESCE(json_extract(je.value, '$.parts'), '[]'),
  json_extract(je.value, '$.metadata'),
  COALESCE(sc.updated_at, unixepoch() * 1000)
FROM sub_chats sc, json_each(sc.messages) je
WHERE sc.messages_migrated_at IS NULL
  AND json_valid(sc.messages)
  AND json_extract(je.value, '$.id') IS NOT NULL
  AND json_extract(je.value, '$.role') IS NOT NULL;
--> statement-breakpoint
UPDATE sub_chats
SET
  message_count = (SELECT COUNT(*) FROM messages WHERE sub_chat_id = sub_chats.id),
  last_message_idx = (SELECT MAX(idx) FROM messages WHERE sub_chat_id = sub_chats.id)
WHERE messages_migrated_at IS NULL;
--> statement-breakpoint
ALTER TABLE sub_chats DROP COLUMN messages;
--> statement-breakpoint
ALTER TABLE sub_chats DROP COLUMN messages_migrated_at;
