ALTER TABLE `credentials` ADD `consecutive_failures` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `credentials` ADD `last_failure_at` integer;
--> statement-breakpoint
ALTER TABLE `credentials` ADD `last_failure_reason` text;
--> statement-breakpoint
ALTER TABLE `request_logs` ADD `trace_id` text;
--> statement-breakpoint
ALTER TABLE `request_logs` ADD `account_id` text;
--> statement-breakpoint
ALTER TABLE `audit_events` ADD `trace_id` text;
--> statement-breakpoint
CREATE INDEX `request_logs_trace_id_idx` ON `request_logs` (`trace_id`);
--> statement-breakpoint
CREATE INDEX `request_logs_account_id_idx` ON `request_logs` (`account_id`);
--> statement-breakpoint
CREATE INDEX `audit_events_trace_id_idx` ON `audit_events` (`trace_id`);
