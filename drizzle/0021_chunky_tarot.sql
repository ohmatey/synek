CREATE TABLE `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`kit` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brands_slug_unique` ON `brands` (`slug`);--> statement-breakpoint
CREATE INDEX `brands_owner_id_idx` ON `brands` (`owner_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `brand_id` text REFERENCES brands(id) ON DELETE SET NULL;