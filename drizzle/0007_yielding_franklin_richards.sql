CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`key_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `api_keys_key_hash_idx` ON `api_keys` (`key_hash`);