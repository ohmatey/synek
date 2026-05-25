CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`timeline_id` text NOT NULL,
	`message_id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`timeline_id`) REFERENCES `timelines`(`id`) ON UPDATE no action ON DELETE cascade
);
