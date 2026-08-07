CREATE TABLE `notification_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`outcome` text NOT NULL,
	`provider` text,
	`status_code` integer,
	`error_code` text,
	`error_message` text,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notification_attempts_job` ON `notification_attempts` (`job_id`,`attempt_number`);--> statement-breakpoint
CREATE TABLE `notification_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`kind` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`channel` text NOT NULL,
	`context_json` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 6 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`locked_at` text,
	`locked_by` text,
	`provider` text,
	`provider_message_id` text,
	`last_error_code` text,
	`last_error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`delivered_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_jobs_dedupe_key_unique` ON `notification_jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notification_jobs_due` ON `notification_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `notification_jobs_subject` ON `notification_jobs` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `notification_jobs_created` ON `notification_jobs` (`created_at`);--> statement-breakpoint
ALTER TABLE `appointments` ADD `reminder_queued_at` text;