CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text DEFAULT 'system' NOT NULL,
	`action` text NOT NULL,
	`resource` text NOT NULL,
	`resource_id` text,
	`result` text DEFAULT 'success' NOT NULL,
	`details` text,
	`ip` text,
	`user_agent` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_created_at_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_action_idx` ON `audit_events` (`action`);--> statement-breakpoint
CREATE INDEX `audit_events_resource_idx` ON `audit_events` (`resource`);