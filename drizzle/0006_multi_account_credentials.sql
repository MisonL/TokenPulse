DROP INDEX IF EXISTS `credentials_provider_unique`;
--> statement-breakpoint
ALTER TABLE `credentials` ADD `account_id` text DEFAULT 'default' NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_provider_account_unique_idx` ON `credentials` (`provider`, `account_id`);
--> statement-breakpoint
CREATE INDEX `credentials_provider_idx` ON `credentials` (`provider`);
