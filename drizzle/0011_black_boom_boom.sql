CREATE TABLE `auth_throttle` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`window_started_at` text NOT NULL,
	`blocked_until` text
);
--> statement-breakpoint
CREATE TABLE `cancellation_reasons` (
	`code` text PRIMARY KEY NOT NULL,
	`label_en` text NOT NULL,
	`label_ar` text NOT NULL,
	`audience` text DEFAULT 'both' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cancellation_reasons_audience` ON `cancellation_reasons` (`audience`,`active`);--> statement-breakpoint
CREATE TABLE `staff_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_digest` text NOT NULL,
	`device` text,
	`client_hash` text,
	`issued_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`revoked_by` text
);
--> statement-breakpoint
CREATE INDEX `staff_sessions_email` ON `staff_sessions` (`email`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `staff_sessions_expires` ON `staff_sessions` (`expires_at`);--> statement-breakpoint
ALTER TABLE `appointments` ADD `cancellation_reason` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `cancellation_note` text;