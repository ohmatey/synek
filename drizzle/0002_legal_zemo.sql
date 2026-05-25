CREATE TABLE `generations` (
	`id` text PRIMARY KEY NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text,
	`cache_key` text,
	`model` text NOT NULL,
	`prompt_template_id` text,
	`prompt_inputs_json` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_cents` integer,
	`latency_ms` integer,
	`human_reviewed` integer DEFAULT false NOT NULL,
	`reviewer_notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`prompt_template_id`) REFERENCES `prompt_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `gen_cache_key_idx` ON `generations` (`cache_key`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`display_name` text NOT NULL,
	`full_name` text,
	`birth_year` integer,
	`death_year` integer,
	`role` text,
	`is_historical` integer DEFAULT true NOT NULL,
	`short_bio` text,
	`portrait_url` text,
	`voice_profile_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_slug_unique` ON `people` (`slug`);--> statement-breakpoint
CREATE TABLE `prompt_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`purpose` text NOT NULL,
	`body` text NOT NULL,
	`system_prompt` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`moment_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`hook` text,
	`pov_type` text DEFAULT 'omniscient' NOT NULL,
	`depth_tier` text DEFAULT 'light' NOT NULL,
	`estimated_minutes` integer,
	`primary_person_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`moment_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`primary_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stories_slug_unique` ON `stories` (`slug`);--> statement-breakpoint
CREATE TABLE `story_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text DEFAULT 'narration' NOT NULL,
	`body_text` text NOT NULL,
	`audio_url` text,
	`setting_note` text,
	`related_node_ids` text,
	`speaker_person_id` text,
	`generation_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`speaker_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`generation_id`) REFERENCES `generations`(`id`) ON UPDATE no action ON DELETE no action
);
