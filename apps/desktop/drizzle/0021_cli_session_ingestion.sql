ALTER TABLE `sub_chats` ADD `cli_session_id` text;
--> statement-breakpoint
ALTER TABLE `sub_chats` ADD `cli_session_file` text;
--> statement-breakpoint
ALTER TABLE `sub_chats` ADD `cli_session_detected_at` integer;
