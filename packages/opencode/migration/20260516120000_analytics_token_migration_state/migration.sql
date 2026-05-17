CREATE TABLE `analytics_token_migration_state` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`processed_messages` integer DEFAULT 0 NOT NULL,
	`total_messages` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	CHECK (`status` IN ('pending', 'in_progress', 'completed'))
);
