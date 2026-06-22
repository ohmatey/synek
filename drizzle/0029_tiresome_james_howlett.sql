CREATE TABLE `story_patches` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`owner_id` text,
	`seq` integer NOT NULL,
	`summary` text NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL,
	`status` text DEFAULT 'applied' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
