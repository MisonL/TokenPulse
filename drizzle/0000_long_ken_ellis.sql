CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`email` text,
	`access_token` text,
	`refresh_token` text,
	`expires_at` integer,
	`metadata` text,
	`last_refresh` text,
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_provider_unique` ON `credentials` (`provider`);--> statement-breakpoint
CREATE TABLE `request_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` text NOT NULL,
	`provider` text,
	`method` text,
	`path` text,
	`status` integer,
	`latency_ms` integer
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`description` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `system_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` text NOT NULL,
	`level` text NOT NULL,
	`source` text NOT NULL,
	`message` text NOT NULL
);
