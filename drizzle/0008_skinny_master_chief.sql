ALTER TABLE `api_keys` ADD `user_id` text REFERENCES user(id);--> statement-breakpoint
CREATE INDEX `api_keys_user_id_idx` ON `api_keys` (`user_id`);