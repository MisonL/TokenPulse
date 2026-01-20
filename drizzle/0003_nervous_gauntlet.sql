ALTER TABLE `credentials` ADD `device_profile` text;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `prompt_tokens` integer;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `completion_tokens` integer;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `model` text;