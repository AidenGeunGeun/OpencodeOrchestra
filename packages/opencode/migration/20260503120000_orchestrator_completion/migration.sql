CREATE TABLE `orchestrator_completion` (
	`child_session_id` text PRIMARY KEY NOT NULL,
	`parent_session_id` text NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`learnings` text,
	`message_id` text,
	`part_id` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`child_session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `orchestrator_completion_parent_idx` ON `orchestrator_completion` (`parent_session_id`);
--> statement-breakpoint
CREATE INDEX `orchestrator_completion_message_idx` ON `orchestrator_completion` (`message_id`);
