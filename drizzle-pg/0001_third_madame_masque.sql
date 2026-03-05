DROP INDEX `credentials_provider_unique`;--> statement-breakpoint
ALTER TABLE `credentials` ADD `status` text DEFAULT 'active';--> statement-breakpoint
ALTER TABLE `credentials` ADD `attributes` text;--> statement-breakpoint
ALTER TABLE `credentials` ADD `next_refresh_after` integer;--> statement-breakpoint
CREATE INDEX `request_logs_timestamp_idx` ON `request_logs` (`timestamp`);--> statement-breakpoint
CREATE INDEX `system_logs_timestamp_idx` ON `system_logs` (`timestamp`);