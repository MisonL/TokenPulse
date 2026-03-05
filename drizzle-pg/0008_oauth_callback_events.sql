CREATE TABLE `oauth_callbacks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `provider` text NOT NULL,
  `state` text,
  `code` text,
  `error` text,
  `source` text NOT NULL,
  `status` text NOT NULL,
  `raw` text,
  `trace_id` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_callbacks_provider_idx` ON `oauth_callbacks` (`provider`);
--> statement-breakpoint
CREATE INDEX `oauth_callbacks_state_idx` ON `oauth_callbacks` (`state`);
--> statement-breakpoint
CREATE INDEX `oauth_callbacks_created_at_idx` ON `oauth_callbacks` (`created_at`);
