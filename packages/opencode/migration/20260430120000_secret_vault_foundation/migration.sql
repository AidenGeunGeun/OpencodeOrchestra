CREATE TABLE `secret_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`label` text,
	`enabled` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `secret_profile_project_idx` ON `secret_profile` (`project_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `secret_profile_project_name_idx` ON `secret_profile` (`project_id`,`name`);
--> statement-breakpoint
CREATE TABLE `secret_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`name` text NOT NULL,
	`label` text,
	`risk` text NOT NULL,
	`enabled` integer NOT NULL,
	`value_ciphertext` text NOT NULL,
	`value_iv` text NOT NULL,
	`value_tag` text NOT NULL,
	`value_version` integer NOT NULL,
	`time_used` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `secret_profile`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `secret_entry_project_idx` ON `secret_entry` (`project_id`);
--> statement-breakpoint
CREATE INDEX `secret_entry_profile_idx` ON `secret_entry` (`profile_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `secret_entry_profile_name_idx` ON `secret_entry` (`profile_id`,`name`);
