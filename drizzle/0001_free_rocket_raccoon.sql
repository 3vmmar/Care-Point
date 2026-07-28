ALTER TABLE `appointments` ADD `client_fingerprint` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `consent_given_at` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `consent_version` text;--> statement-breakpoint
CREATE INDEX `appointments_status_date` ON `appointments` (`status`,`slot_date`);--> statement-breakpoint
CREATE INDEX `appointments_hold_token` ON `appointments` (`hold_token`);