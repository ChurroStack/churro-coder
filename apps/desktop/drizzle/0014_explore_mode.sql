UPDATE `sub_chats` SET `mode` = 'execute' WHERE `mode` = 'agent';
--> statement-breakpoint
UPDATE `sub_chats` SET `session_mode` = 'execute' WHERE `session_mode` = 'agent';
--> statement-breakpoint
UPDATE `sub_chats` SET `mode` = 'plan' WHERE `mode` IS NULL;
