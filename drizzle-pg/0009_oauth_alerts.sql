CREATE TABLE `oauth_alert_configs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `warning_rate_threshold_bps` integer DEFAULT 2000 NOT NULL,
  `warning_failure_count_threshold` integer DEFAULT 10 NOT NULL,
  `critical_rate_threshold_bps` integer DEFAULT 3500 NOT NULL,
  `critical_failure_count_threshold` integer DEFAULT 20 NOT NULL,
  `recovery_rate_threshold_bps` integer DEFAULT 1000 NOT NULL,
  `recovery_failure_count_threshold` integer DEFAULT 5 NOT NULL,
  `dedupe_window_sec` integer DEFAULT 600 NOT NULL,
  `recovery_consecutive_windows` integer DEFAULT 2 NOT NULL,
  `window_size_sec` integer DEFAULT 300 NOT NULL,
  `quiet_hours_enabled` integer DEFAULT 0 NOT NULL,
  `quiet_hours_start` text DEFAULT '00:00' NOT NULL,
  `quiet_hours_end` text DEFAULT '00:00' NOT NULL,
  `quiet_hours_timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
  `mute_providers` text DEFAULT '[]' NOT NULL,
  `min_delivery_severity` text DEFAULT 'warning' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_alert_configs_updated_at_idx` ON `oauth_alert_configs` (`updated_at`);
--> statement-breakpoint
CREATE TABLE `oauth_alert_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `provider` text NOT NULL,
  `phase` text NOT NULL,
  `severity` text NOT NULL,
  `total_count` integer NOT NULL,
  `failure_count` integer NOT NULL,
  `failure_rate_bps` integer NOT NULL,
  `window_start` integer NOT NULL,
  `window_end` integer NOT NULL,
  `status_breakdown` text,
  `dedupe_key` text NOT NULL,
  `message` text,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_alert_events_created_at_idx` ON `oauth_alert_events` (`created_at`);
--> statement-breakpoint
CREATE INDEX `oauth_alert_events_query_idx` ON `oauth_alert_events` (`provider`, `phase`, `created_at`);
--> statement-breakpoint
CREATE INDEX `oauth_alert_events_dedupe_idx` ON `oauth_alert_events` (`dedupe_key`, `created_at`);
--> statement-breakpoint
CREATE TABLE `oauth_alert_deliveries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `event_id` integer NOT NULL,
  `channel` text NOT NULL,
  `target` text,
  `attempt` integer DEFAULT 1 NOT NULL,
  `status` text NOT NULL,
  `response_status` integer,
  `response_body` text,
  `error` text,
  `sent_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_alert_deliveries_event_id_idx` ON `oauth_alert_deliveries` (`event_id`);
--> statement-breakpoint
CREATE INDEX `oauth_alert_deliveries_channel_idx` ON `oauth_alert_deliveries` (`channel`);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_alert_deliveries_attempt_unique_idx` ON `oauth_alert_deliveries` (`event_id`, `channel`, `attempt`);
--> statement-breakpoint
CREATE INDEX `oauth_alert_deliveries_sent_at_idx` ON `oauth_alert_deliveries` (`sent_at`);
