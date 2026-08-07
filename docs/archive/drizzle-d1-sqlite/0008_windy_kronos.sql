CREATE TABLE `pilot_checklist` (
	`item_key` text PRIMARY KEY NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`note` text,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pilot_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`summary` text NOT NULL,
	`severity` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`opened_by` text NOT NULL,
	`opened_at` text NOT NULL,
	`resolved_by` text,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `pilot_incidents_status` ON `pilot_incidents` (`status`,`opened_at`);--> statement-breakpoint
CREATE TABLE `pilot_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`week_start` text NOT NULL,
	`branch_id` text,
	`bookings` integer NOT NULL,
	`completed` integer NOT NULL,
	`no_shows` integer NOT NULL,
	`cancelled` integer NOT NULL,
	`notification_total` integer NOT NULL,
	`notification_failed` integer NOT NULL,
	`open_incidents` integer NOT NULL,
	`recommendation` text NOT NULL,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pilot_reviews_week` ON `pilot_reviews` (`week_start`);--> statement-breakpoint
CREATE INDEX `pilot_reviews_created` ON `pilot_reviews` (`created_at`);--> statement-breakpoint
CREATE TABLE `pilot_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'setup' NOT NULL,
	`branch_id` text,
	`start_date` text,
	`end_date` text,
	`decision` text DEFAULT 'pending' NOT NULL,
	`decision_note` text,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
