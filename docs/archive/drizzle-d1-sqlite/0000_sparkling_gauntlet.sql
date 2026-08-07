CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`hold_token` text NOT NULL,
	`status` text DEFAULT 'held' NOT NULL,
	`branch` text NOT NULL,
	`service` text NOT NULL,
	`slot_date` text NOT NULL,
	`slot_time` text NOT NULL,
	`duration_minutes` integer DEFAULT 45 NOT NULL,
	`patient_name` text,
	`patient_phone` text,
	`patient_email` text,
	`language` text DEFAULT 'en' NOT NULL,
	`source` text DEFAULT 'website' NOT NULL,
	`created_at` text NOT NULL,
	`hold_expires_at` text,
	`confirmed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_slot_unique` ON `appointments` (`branch`,`slot_date`,`slot_time`);