CREATE TABLE `appointment_cells` (
	`branch` text NOT NULL,
	`practitioner` text NOT NULL,
	`slot_date` text NOT NULL,
	`cell_time` text NOT NULL,
	`appointment_id` text NOT NULL,
	PRIMARY KEY(`branch`, `practitioner`, `slot_date`, `cell_time`)
);
--> statement-breakpoint
CREATE INDEX `appointment_cells_appointment` ON `appointment_cells` (`appointment_id`);--> statement-breakpoint
DROP INDEX IF EXISTS `appointments_slot_live_unique`;--> statement-breakpoint
ALTER TABLE `appointments` ADD `practitioner` text;