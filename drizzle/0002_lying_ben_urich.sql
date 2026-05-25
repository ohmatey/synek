CREATE TABLE `chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`timeline_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`timeline_id`) REFERENCES `timelines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `session_id` text REFERENCES chat_sessions(id);