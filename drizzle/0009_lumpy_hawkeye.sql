ALTER TABLE `timelines` ADD `owner_id` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `timelines` ADD `is_public` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `timelines_owner_id_idx` ON `timelines` (`owner_id`);--> statement-breakpoint
-- Backfill: adopt any pre-ownership timelines to the first/earliest user so a
-- dev's existing local timelines aren't orphaned by the now-scoped list.
UPDATE `timelines` SET `owner_id` = (SELECT `id` FROM `user` ORDER BY `created_at` LIMIT 1) WHERE `owner_id` IS NULL;