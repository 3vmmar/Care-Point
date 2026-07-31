CREATE TABLE `data_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requester_name` text NOT NULL,
	`requester_phone` text NOT NULL,
	`requester_email` text,
	`note` text,
	`language` text DEFAULT 'en' NOT NULL,
	`client_hash` text,
	`created_at` text NOT NULL,
	`resolved_by` text,
	`resolved_at` text,
	`resolution` text,
	`affected_count` integer
);
--> statement-breakpoint
CREATE INDEX `data_requests_status` ON `data_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `data_requests_phone` ON `data_requests` (`requester_phone`);