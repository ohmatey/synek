CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`artifact_type` text NOT NULL,
	`date_instant` integer,
	`date_precision` text DEFAULT 'year' NOT NULL,
	`transcript` text,
	`translation` text,
	`image_url` text,
	`reliability` text,
	`reliability_note` text,
	`artifact_source_type` text,
	`source_id` text,
	`attributed_person_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`attributed_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `artifacts_title_idx` ON `artifacts` (`title`);--> statement-breakpoint
CREATE INDEX `artifacts_source_id_idx` ON `artifacts` (`source_id`);--> statement-breakpoint
CREATE TABLE `moment_artifacts` (
	`moment_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`note` text,
	PRIMARY KEY(`moment_id`, `artifact_id`),
	FOREIGN KEY (`moment_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `moment_artifacts_artifact_idx` ON `moment_artifacts` (`artifact_id`);--> statement-breakpoint
CREATE TABLE `segment_citations` (
	`segment_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`excerpt_used` text,
	PRIMARY KEY(`segment_id`, `artifact_id`),
	FOREIGN KEY (`segment_id`) REFERENCES `story_segments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `segment_citations_artifact_idx` ON `segment_citations` (`artifact_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`year` integer,
	`citation` text,
	`url` text,
	`source_type` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `story_artifacts` (
	`story_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`relationship` text DEFAULT 'referenced' NOT NULL,
	PRIMARY KEY(`story_id`, `artifact_id`),
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_artifacts_artifact_idx` ON `story_artifacts` (`artifact_id`);--> statement-breakpoint
-- ===========================================================================
-- HAND-AUTHORED (ADR 0001, Decision 6): FTS5 external-content index + sync
-- triggers over artifacts(title, transcript, translation). drizzle-kit does NOT
-- model virtual tables or triggers, so it will NOT generate or diff these — any
-- future change to those columns must be hand-migrated in a NEW migration.
-- The `'delete'` command-row idiom evicts external-content rows (FTS5 can't read
-- the deleted base row). Keyed on artifacts.rowid (a normal WITH-ROWID table).
-- ===========================================================================
CREATE VIRTUAL TABLE `artifacts_fts` USING fts5(
  title, transcript, translation,
  content='artifacts',
  content_rowid='rowid'
);--> statement-breakpoint
CREATE TRIGGER `artifacts_ai` AFTER INSERT ON `artifacts` BEGIN
  INSERT INTO artifacts_fts(rowid, title, transcript, translation)
  VALUES (new.rowid, new.title, new.transcript, new.translation);
END;--> statement-breakpoint
CREATE TRIGGER `artifacts_ad` AFTER DELETE ON `artifacts` BEGIN
  INSERT INTO artifacts_fts(artifacts_fts, rowid, title, transcript, translation)
  VALUES ('delete', old.rowid, old.title, old.transcript, old.translation);
END;--> statement-breakpoint
CREATE TRIGGER `artifacts_au` AFTER UPDATE ON `artifacts` BEGIN
  INSERT INTO artifacts_fts(artifacts_fts, rowid, title, transcript, translation)
  VALUES ('delete', old.rowid, old.title, old.transcript, old.translation);
  INSERT INTO artifacts_fts(rowid, title, transcript, translation)
  VALUES (new.rowid, new.title, new.transcript, new.translation);
END;