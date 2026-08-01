CREATE TABLE `security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`event` text NOT NULL,
	`outcome` text NOT NULL,
	`subject` text,
	`detail` text,
	`client_hash` text,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `security_events_actor_at` ON `security_events` (`actor`,`at`);--> statement-breakpoint
CREATE INDEX `security_events_event_at` ON `security_events` (`event`,`at`);--> statement-breakpoint
CREATE INDEX `security_events_at` ON `security_events` (`at`);--> statement-breakpoint
CREATE TABLE `staff_recovery_codes` (
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`email`, `code_hash`)
);
--> statement-breakpoint
CREATE INDEX `staff_recovery_codes_email` ON `staff_recovery_codes` (`email`,`used_at`);--> statement-breakpoint
ALTER TABLE `staff_users` ADD `totp_secret` text;--> statement-breakpoint
ALTER TABLE `staff_users` ADD `totp_confirmed_at` text;--> statement-breakpoint
ALTER TABLE `staff_users` ADD `totp_last_counter` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `staff_users` ADD `failed_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `staff_users` ADD `locked_until` text;--> statement-breakpoint
ALTER TABLE `staff_users` ADD `session_epoch` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `staff_users` ADD `invited_by` text;--> statement-breakpoint
ALTER TABLE `staff_users` ADD `last_seen_at` text;