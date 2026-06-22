CREATE TABLE `story_series` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`hook` text,
	`cover_image` text,
	`theme` text,
	`anchor_moment_id` text,
	`is_public` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `story_series_slug_unique` ON `story_series` (`slug`);--> statement-breakpoint
CREATE INDEX `story_series_project_id_idx` ON `story_series` (`project_id`);--> statement-breakpoint
ALTER TABLE `stories` ADD `series_id` text REFERENCES story_series(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `stories` ADD `chapter_number` integer;