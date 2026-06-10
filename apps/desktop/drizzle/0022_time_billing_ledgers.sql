CREATE TABLE `work_intervals` (
	`id` text PRIMARY KEY NOT NULL,
	`sub_chat_id` text NOT NULL,
	`project_id` text,
	`project_name` text,
	`chat_id` text,
	`chat_name` text,
	`sub_chat_name` text,
	`harness` text DEFAULT 'builtin' NOT NULL,
	`source` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`origin` text DEFAULT 'live' NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `work_intervals_sub_chat_id_idx` ON `work_intervals` (`sub_chat_id`);
--> statement-breakpoint
CREATE INDEX `work_intervals_started_at_idx` ON `work_intervals` (`started_at`);
--> statement-breakpoint
CREATE TABLE `token_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`date_key` text NOT NULL,
	`project_id` text,
	`project_name` text,
	`chat_id` text,
	`chat_name` text,
	`sub_chat_id` text NOT NULL,
	`sub_chat_name` text,
	`harness` text,
	`source` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_micro_usd` integer DEFAULT 0 NOT NULL,
	`unpriced` integer DEFAULT 0 NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `token_daily_day_subchat_source_model_uq` ON `token_daily` (`date_key`,`sub_chat_id`,`source`,`model`);
--> statement-breakpoint
CREATE INDEX `token_daily_date_key_idx` ON `token_daily` (`date_key`);
