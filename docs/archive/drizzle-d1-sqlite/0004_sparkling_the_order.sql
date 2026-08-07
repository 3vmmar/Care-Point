CREATE TABLE `access_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`subject_id` text,
	`subject_count` integer DEFAULT 1 NOT NULL,
	`client_hash` text,
	`detail` text,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `access_log_actor_at` ON `access_log` (`actor`,`at`);--> statement-breakpoint
CREATE INDEX `access_log_subject` ON `access_log` (`subject_id`);--> statement-breakpoint
CREATE INDEX `access_log_at` ON `access_log` (`at`);