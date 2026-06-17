CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`start_instant` integer NOT NULL,
	`end_instant` integer,
	`precision` text DEFAULT 'year' NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `entity_patches` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`owner_id` text,
	`seq` integer NOT NULL,
	`summary` text NOT NULL,
	`ops` text NOT NULL,
	`inverse_ops` text NOT NULL,
	`status` text DEFAULT 'applied' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `nodes` ADD `entity_id` text REFERENCES entities(id);
--> statement-breakpoint
-- ADR 0004 backfill: one canonical entity per existing node (1:1). Reuse the node's
-- OWN id as its entity id, so linking needs no correlation table. owner_id comes from
-- the node's timeline owner; metadata copied as-is (the read overlay takes `lane` from
-- the node, so a stray lane on the entity is ignored). Mirrors 0019/0020 (nullable
-- add, correlated backfill, sole-user fallback, NO not-null rebuild).
INSERT INTO `entities` (`id`, `owner_id`, `type`, `title`, `summary`, `start_instant`, `end_instant`, `precision`, `metadata`, `created_at`, `updated_at`)
SELECT n.`id`, t.`owner_id`, n.`type`, n.`title`, n.`summary`, n.`start_instant`, n.`end_instant`, n.`precision`, n.`metadata`, n.`created_at`, n.`created_at`
FROM `nodes` n JOIN `timelines` t ON t.`id` = n.`timeline_id`;
--> statement-breakpoint
-- Self-host sole-user fallback: a null-owner timeline's entity adopts the only user.
UPDATE `entities` SET `owner_id` = (SELECT `id` FROM `user` LIMIT 1)
WHERE `owner_id` IS NULL AND (SELECT COUNT(*) FROM `user`) = 1;
--> statement-breakpoint
UPDATE `nodes` SET `entity_id` = `id` WHERE `entity_id` IS NULL;