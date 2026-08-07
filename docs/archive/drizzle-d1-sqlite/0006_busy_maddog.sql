CREATE TABLE `clinic_branches` (
	`id` text PRIMARY KEY NOT NULL,
	`name_en` text NOT NULL,
	`name_ar` text NOT NULL,
	`address_en` text NOT NULL,
	`address_ar` text NOT NULL,
	`map_url` text,
	`timezone` text DEFAULT 'Africa/Cairo' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clinic_services` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`name_en` text NOT NULL,
	`name_ar` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`turnaround_minutes` integer DEFAULT 10 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `clinic_services_department` ON `clinic_services` (`department_id`,`active`);--> statement-breakpoint
CREATE TABLE `departments` (
	`id` text PRIMARY KEY NOT NULL,
	`name_en` text NOT NULL,
	`name_ar` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `practitioner_branches` (
	`practitioner_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`practitioner_id`, `branch_id`)
);
--> statement-breakpoint
CREATE TABLE `practitioners` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`name_en` text NOT NULL,
	`name_ar` text NOT NULL,
	`title_en` text NOT NULL,
	`title_ar` text NOT NULL,
	`credentials` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `practitioners_department` ON `practitioners` (`department_id`,`active`);--> statement-breakpoint
CREATE TABLE `schedule_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`practitioner_id` text,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`reason` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `schedule_exceptions_branch_date` ON `schedule_exceptions` (`branch_id`,`date`);--> statement-breakpoint
CREATE INDEX `schedule_exceptions_practitioner_date` ON `schedule_exceptions` (`practitioner_id`,`date`);--> statement-breakpoint
CREATE TABLE `service_practitioners` (
	`service_id` text NOT NULL,
	`practitioner_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`service_id`, `practitioner_id`)
);
--> statement-breakpoint
CREATE TABLE `staff_user_roles` (
	`email` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`email`, `role`)
);
--> statement-breakpoint
CREATE TABLE `staff_users` (
	`email` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weekly_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`practitioner_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`interval_minutes` integer DEFAULT 30 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `weekly_sessions_branch_day` ON `weekly_sessions` (`branch_id`,`weekday`,`active`);--> statement-breakpoint
CREATE INDEX `weekly_sessions_practitioner_day` ON `weekly_sessions` (`practitioner_id`,`weekday`,`active`);