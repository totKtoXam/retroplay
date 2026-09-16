-- IF NOT EXISTS: ту же таблицу создаёт ensureAuthTables() из db/auth.ts.
CREATE TABLE IF NOT EXISTS `user_settings` (
	`user` text PRIMARY KEY NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`updated` integer NOT NULL,
	FOREIGN KEY (`user`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
