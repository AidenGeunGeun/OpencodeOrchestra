ALTER TABLE `analytics_response` ADD `calls` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TABLE `analytics_skipped_response` (
	`message_id` text PRIMARY KEY NOT NULL,
	`session_id` text DEFAULT '' NOT NULL,
	`reason` text NOT NULL,
	`source_created_at` integer DEFAULT 0 NOT NULL,
	`cutoff_at` integer DEFAULT 0 NOT NULL,
	`skipped_at` integer DEFAULT 0 NOT NULL,
	`fresh_input` integer DEFAULT 0 NOT NULL,
	`output` integer DEFAULT 0 NOT NULL,
	`reasoning` integer DEFAULT 0 NOT NULL,
	`cache_read` integer DEFAULT 0 NOT NULL,
	`cache_write` integer DEFAULT 0 NOT NULL,
	`actual_cost` real DEFAULT 0 NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analytics_skipped_response_reason_idx` ON `analytics_skipped_response` (`reason`);
