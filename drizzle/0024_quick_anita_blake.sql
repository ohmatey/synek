ALTER TABLE `stories` ADD `is_public` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE `stories` SET `is_public` = 1 WHERE `moment_id` IN (
  SELECT `n`.`id` FROM `nodes` `n`
  JOIN `timelines` `t` ON `n`.`timeline_id` = `t`.`id`
  WHERE `t`.`is_public` = 1
);
