CREATE TABLE `series_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`user_id` text NOT NULL,
	`unsubscribe_token` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `story_series`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_subscriptions_unsubscribe_token_unique` ON `series_subscriptions` (`unsubscribe_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `series_subscriptions_series_user_uq` ON `series_subscriptions` (`series_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `series_subscriptions_series_idx` ON `series_subscriptions` (`series_id`);