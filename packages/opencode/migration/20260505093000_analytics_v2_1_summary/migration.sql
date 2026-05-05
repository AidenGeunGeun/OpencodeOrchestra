CREATE TABLE `analytics_daily` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`agent` text NOT NULL,
	`project_key` text NOT NULL,
	`project_label` text DEFAULT '' NOT NULL,
	`directory` text DEFAULT '' NOT NULL,
	`fresh_input` integer DEFAULT 0 NOT NULL,
	`output` integer DEFAULT 0 NOT NULL,
	`reasoning` integer DEFAULT 0 NOT NULL,
	`cache_read` integer DEFAULT 0 NOT NULL,
	`cache_write` integer DEFAULT 0 NOT NULL,
	`actual_cost` real DEFAULT 0 NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`session_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_daily_unique` ON `analytics_daily` (`day`,`provider`,`model`,`agent`,`project_key`);
--> statement-breakpoint
CREATE INDEX `analytics_daily_day_idx` ON `analytics_daily` (`day`);
--> statement-breakpoint
CREATE INDEX `analytics_daily_project_key_idx` ON `analytics_daily` (`project_key`);
--> statement-breakpoint
CREATE TABLE `analytics_session` (
	`session_id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`directory` text DEFAULT '' NOT NULL,
	`project_key` text DEFAULT '' NOT NULL,
	`project_label` text DEFAULT '' NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`agent` text DEFAULT '' NOT NULL,
	`fresh_input` integer DEFAULT 0 NOT NULL,
	`output` integer DEFAULT 0 NOT NULL,
	`reasoning` integer DEFAULT 0 NOT NULL,
	`cache_read` integer DEFAULT 0 NOT NULL,
	`cache_write` integer DEFAULT 0 NOT NULL,
	`actual_cost` real DEFAULT 0 NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`last_message_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analytics_session_project_idx` ON `analytics_session` (`project_key`);
--> statement-breakpoint
CREATE TABLE `analytics_response` (
	`message_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`directory` text DEFAULT '' NOT NULL,
	`project_key` text DEFAULT '' NOT NULL,
	`project_label` text DEFAULT '' NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`agent` text NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	`fresh_input` integer DEFAULT 0 NOT NULL,
	`output` integer DEFAULT 0 NOT NULL,
	`reasoning` integer DEFAULT 0 NOT NULL,
	`cache_read` integer DEFAULT 0 NOT NULL,
	`cache_write` integer DEFAULT 0 NOT NULL,
	`actual_cost` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analytics_response_session_idx` ON `analytics_response` (`session_id`);
--> statement-breakpoint
CREATE INDEX `analytics_response_created_idx` ON `analytics_response` (`created_at`);
--> statement-breakpoint
CREATE TABLE `analytics_watermark` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_time_created` integer DEFAULT 0 NOT NULL,
	`last_message_id` text DEFAULT '' NOT NULL,
	`total_messages` integer DEFAULT 0 NOT NULL,
	`processed_messages` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	CHECK (id = 1)
);
--> statement-breakpoint
CREATE INDEX `message_time_created_idx` ON `message` (`time_created`);
