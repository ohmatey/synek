CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`openrouter_key_enc` text,
	`openrouter_key_prefix` text,
	`agent_model` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `artifacts` ADD `owner_id` text REFERENCES user(id);--> statement-breakpoint
CREATE INDEX `artifacts_owner_id_idx` ON `artifacts` (`owner_id`);--> statement-breakpoint
ALTER TABLE `sources` ADD `owner_id` text REFERENCES user(id);--> statement-breakpoint
-- Backfill artifact/source ownership for upgrading installs (Phase 2). A fresh
-- hosted DB has no rows, so these no-op. Linked artifacts inherit their timeline's
-- owner; remaining orphans go to the sole user when exactly one exists (self-host).
UPDATE `artifacts` SET `owner_id` = (
  SELECT t.owner_id FROM moment_artifacts ma
  JOIN nodes n ON n.id = ma.moment_id
  JOIN timelines t ON t.id = n.timeline_id
  WHERE ma.artifact_id = artifacts.id AND t.owner_id IS NOT NULL LIMIT 1
) WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `artifacts` SET `owner_id` = (
  SELECT t.owner_id FROM story_artifacts sa
  JOIN stories s ON s.id = sa.story_id
  JOIN nodes n ON n.id = s.moment_id
  JOIN timelines t ON t.id = n.timeline_id
  WHERE sa.artifact_id = artifacts.id AND t.owner_id IS NOT NULL LIMIT 1
) WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `artifacts` SET `owner_id` = (SELECT id FROM user LIMIT 1)
  WHERE `owner_id` IS NULL AND (SELECT COUNT(*) FROM user) = 1;--> statement-breakpoint
UPDATE `sources` SET `owner_id` = (
  SELECT a.owner_id FROM artifacts a WHERE a.source_id = sources.id AND a.owner_id IS NOT NULL LIMIT 1
) WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `sources` SET `owner_id` = (SELECT id FROM user LIMIT 1)
  WHERE `owner_id` IS NULL AND (SELECT COUNT(*) FROM user) = 1;