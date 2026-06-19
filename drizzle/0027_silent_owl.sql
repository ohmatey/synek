CREATE TABLE `usage_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`ts` integer NOT NULL,
	`source` text NOT NULL,
	`metric` text NOT NULL,
	`quantity` integer NOT NULL,
	`model` text,
	`funded` text NOT NULL,
	`your_cost_cents` integer,
	`meta` text,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `usage_ledger_owner_ts_idx` ON `usage_ledger` (`owner_id`,`ts`);