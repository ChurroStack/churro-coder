ALTER TABLE `sub_chats` ADD `openspec_change_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `sub_chats_chat_id_openspec_change_id_unique` ON `sub_chats` (`chat_id`, `openspec_change_id`) WHERE `openspec_change_id` IS NOT NULL;
