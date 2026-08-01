ALTER TABLE `schedule_exceptions` ADD `reason_ar` text;--> statement-breakpoint
ALTER TABLE `weekly_sessions` ADD `categories` text DEFAULT '' NOT NULL;