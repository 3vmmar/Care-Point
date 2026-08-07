-- Hand-adjusted after generation: drizzle-kit emits `PRAGMA foreign_keys=OFF/ON`
-- around table rebuilds, which Cloudflare D1 rejects. D1's supported form is
-- `PRAGMA defer_foreign_keys = on`, which resets itself at transaction end, so
-- the closing pragma is deliberately absent. Content is otherwise as generated.
DROP INDEX `appointments_hold_token`;--> statement-breakpoint
DROP INDEX `appointments_manage_token`;--> statement-breakpoint
CREATE INDEX `appointments_branch_date_status` ON `appointments` (`branch`,`slot_date`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_hold_token` ON `appointments` (`hold_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_manage_token` ON `appointments` (`manage_token`);--> statement-breakpoint
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_appointment_cells` (
	`branch` text NOT NULL,
	`practitioner` text NOT NULL,
	`slot_date` text NOT NULL,
	`cell_time` text NOT NULL,
	`appointment_id` text NOT NULL,
	PRIMARY KEY(`branch`, `practitioner`, `slot_date`, `cell_time`),
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_appointment_cells`("branch", "practitioner", "slot_date", "cell_time", "appointment_id") SELECT "branch", "practitioner", "slot_date", "cell_time", "appointment_id" FROM `appointment_cells`;--> statement-breakpoint
DROP TABLE `appointment_cells`;--> statement-breakpoint
ALTER TABLE `__new_appointment_cells` RENAME TO `appointment_cells`;--> statement-breakpoint
CREATE INDEX `appointment_cells_appointment` ON `appointment_cells` (`appointment_id`);--> statement-breakpoint
CREATE TABLE `__new_notification_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`outcome` text NOT NULL,
	`provider` text,
	`status_code` integer,
	`error_code` text,
	`error_message` text,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `notification_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_notification_attempts`("id", "job_id", "attempt_number", "outcome", "provider", "status_code", "error_code", "error_message", "started_at", "finished_at") SELECT "id", "job_id", "attempt_number", "outcome", "provider", "status_code", "error_code", "error_message", "started_at", "finished_at" FROM `notification_attempts`;--> statement-breakpoint
DROP TABLE `notification_attempts`;--> statement-breakpoint
ALTER TABLE `__new_notification_attempts` RENAME TO `notification_attempts`;--> statement-breakpoint
CREATE INDEX `notification_attempts_job` ON `notification_attempts` (`job_id`,`attempt_number`);