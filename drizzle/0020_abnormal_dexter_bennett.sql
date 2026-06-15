CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`kind` text DEFAULT 'nonfiction' NOT NULL,
	`world` text,
	`brand_ref` text,
	`theme` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE INDEX `projects_owner_id_idx` ON `projects` (`owner_id`);--> statement-breakpoint
ALTER TABLE `artifacts` ADD `project_id` text REFERENCES projects(id);--> statement-breakpoint
CREATE INDEX `artifacts_project_id_idx` ON `artifacts` (`project_id`);--> statement-breakpoint
ALTER TABLE `sources` ADD `project_id` text REFERENCES projects(id);--> statement-breakpoint
CREATE INDEX `sources_project_id_idx` ON `sources` (`project_id`);--> statement-breakpoint
ALTER TABLE `timelines` ADD `project_id` text REFERENCES projects(id);--> statement-breakpoint
CREATE INDEX `timelines_project_id_idx` ON `timelines` (`project_id`);--> statement-breakpoint
-- Backfill (ADR 0002 D7/D8; mirrors 0019). A fresh hosted DB has no rows, so every
-- statement no-ops. NO NOT-NULL rebuild: project_id stays nullable everywhere;
-- ownerId remains the only security boundary, the write path enforces presence.
--
-- 1) Seed ONE default project per existing owner ("My first project"). Owners come
-- from any owned row (timelines/artifacts/sources) so an owner with only resources
-- still gets a project. id via lower(hex(randomblob(16))); slug is global-unique by
-- suffixing the owner's user.rowid (the human title stays "My first project" for all).
INSERT INTO `projects` (`id`, `owner_id`, `slug`, `title`, `kind`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))),
       u.id,
       'my-first-project-' || u.rowid,
       'My first project',
       'nonfiction',
       CAST(strftime('%s','now') AS INTEGER) * 1000,
       CAST(strftime('%s','now') AS INTEGER) * 1000
FROM `user` u
WHERE u.id IN (
  SELECT owner_id FROM timelines WHERE owner_id IS NOT NULL
  UNION SELECT owner_id FROM artifacts WHERE owner_id IS NOT NULL
  UNION SELECT owner_id FROM sources WHERE owner_id IS NOT NULL
)
AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.owner_id = u.id);--> statement-breakpoint
-- 2) Point every timeline at its owner's default project.
UPDATE `timelines` SET `project_id` = (
  SELECT p.id FROM projects p WHERE p.owner_id = timelines.owner_id LIMIT 1
) WHERE `project_id` IS NULL AND `owner_id` IS NOT NULL;--> statement-breakpoint
-- 3) Sole-user self-host fallback: any still-null timeline → the sole user's default
-- project when exactly one user exists (mirrors 0019:29,34).
UPDATE `timelines` SET `project_id` = (
  SELECT p.id FROM projects p WHERE p.owner_id = (SELECT id FROM user LIMIT 1) LIMIT 1
) WHERE `project_id` IS NULL AND (SELECT COUNT(*) FROM user) = 1;--> statement-breakpoint
-- 4) Backfill artifacts.project_id from the linked timeline's project_id (the
-- moment_artifacts / story_artifacts → nodes → timelines walk, copying 0019:16-28
-- but selecting t.project_id instead of t.owner_id).
UPDATE `artifacts` SET `project_id` = (
  SELECT t.project_id FROM moment_artifacts ma
  JOIN nodes n ON n.id = ma.moment_id
  JOIN timelines t ON t.id = n.timeline_id
  WHERE ma.artifact_id = artifacts.id AND t.project_id IS NOT NULL LIMIT 1
) WHERE `project_id` IS NULL;--> statement-breakpoint
UPDATE `artifacts` SET `project_id` = (
  SELECT t.project_id FROM story_artifacts sa
  JOIN stories s ON s.id = sa.story_id
  JOIN nodes n ON n.id = s.moment_id
  JOIN timelines t ON t.id = n.timeline_id
  WHERE sa.artifact_id = artifacts.id AND t.project_id IS NOT NULL LIMIT 1
) WHERE `project_id` IS NULL;--> statement-breakpoint
-- Orphan artifacts (no linked timeline) → their owner's default project.
UPDATE `artifacts` SET `project_id` = (
  SELECT p.id FROM projects p WHERE p.owner_id = artifacts.owner_id LIMIT 1
) WHERE `project_id` IS NULL AND `owner_id` IS NOT NULL;--> statement-breakpoint
-- Sole-user self-host fallback for any residual artifact.
UPDATE `artifacts` SET `project_id` = (
  SELECT p.id FROM projects p WHERE p.owner_id = (SELECT id FROM user LIMIT 1) LIMIT 1
) WHERE `project_id` IS NULL AND (SELECT COUNT(*) FROM user) = 1;--> statement-breakpoint
-- 5) Sources inherit their artifact's project (mirror 0019:31-33), then orphan →
-- owner default, then sole-user fallback.
UPDATE `sources` SET `project_id` = (
  SELECT a.project_id FROM artifacts a WHERE a.source_id = sources.id AND a.project_id IS NOT NULL LIMIT 1
) WHERE `project_id` IS NULL;--> statement-breakpoint
UPDATE `sources` SET `project_id` = (
  SELECT p.id FROM projects p WHERE p.owner_id = sources.owner_id LIMIT 1
) WHERE `project_id` IS NULL AND `owner_id` IS NOT NULL;--> statement-breakpoint
UPDATE `sources` SET `project_id` = (
  SELECT p.id FROM projects p WHERE p.owner_id = (SELECT id FROM user LIMIT 1) LIMIT 1
) WHERE `project_id` IS NULL AND (SELECT COUNT(*) FROM user) = 1;