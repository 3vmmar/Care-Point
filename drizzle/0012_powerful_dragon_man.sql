ALTER TABLE `staff_users` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `staff_users` ADD `password_set_at` text;--> statement-breakpoint
ALTER TABLE `staff_users` ADD `must_change_password` integer DEFAULT false NOT NULL;