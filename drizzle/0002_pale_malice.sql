DROP INDEX IF EXISTS `appointments_slot_unique`;--> statement-breakpoint
ALTER TABLE `appointments` ADD `patient_note` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `staff_note` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `manage_token` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `checked_in_at` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `cancelled_at` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `cancelled_by` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `status_updated_at` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `reminder_sent_at` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `purged_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_slot_live_unique` ON `appointments` (`branch`,`slot_date`,`slot_time`) WHERE status <> 'cancelled';--> statement-breakpoint
CREATE INDEX `appointments_manage_token` ON `appointments` (`manage_token`);--> statement-breakpoint
CREATE INDEX `appointments_slot_date` ON `appointments` (`slot_date`);