ALTER TABLE `projects` ADD `sandbox_enabled` integer;
--> statement-breakpoint
ALTER TABLE `chats` ADD `sandbox_enabled` integer;
--> statement-breakpoint
CREATE TABLE `sandbox_settings` (
  `id` text PRIMARY KEY NOT NULL DEFAULT 'singleton',
  `extra_writable_paths` text NOT NULL DEFAULT '[]',
  `extra_denied_paths` text NOT NULL DEFAULT '[]',
  `allow_toolchain_caches` integer NOT NULL DEFAULT 1,
  `updated_at` integer
);
