CREATE TABLE `messages` (
  `sub_chat_id` text NOT NULL,
  `idx` integer NOT NULL,
  `id` text NOT NULL,
  `role` text NOT NULL,
  `parts` text NOT NULL,
  `metadata` text,
  `created_at` integer NOT NULL,
  PRIMARY KEY (`sub_chat_id`, `idx`),
  FOREIGN KEY (`sub_chat_id`) REFERENCES `sub_chats`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_sub_chat_id_message_id_uq` ON `messages` (`sub_chat_id`, `id`);
--> statement-breakpoint
ALTER TABLE `sub_chats` ADD COLUMN `message_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `sub_chats` ADD COLUMN `last_message_idx` integer;
--> statement-breakpoint
ALTER TABLE `sub_chats` ADD COLUMN `messages_migrated_at` integer;
