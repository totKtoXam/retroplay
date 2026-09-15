-- IF NOT EXISTS: те же таблицы создаёт ensureAuthTables() из db/auth.ts,
-- чтобы вход работал и в базе, куда миграция ещё не доехала.
CREATE TABLE IF NOT EXISTS `auth_sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`created` integer NOT NULL,
	`expires` integer NOT NULL,
	`seen` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_auth_sessions_user` ON `auth_sessions` (`user`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `auth_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`kind` text NOT NULL,
	`expires` integer NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`user`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_auth_tokens_user` ON `auth_tokens` (`user`,`kind`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `users` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT 0 NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`password_hash` text DEFAULT '' NOT NULL,
	`google_sub` text DEFAULT '' NOT NULL,
	`avatar` text DEFAULT '' NOT NULL,
	`failed_logins` integer DEFAULT 0 NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_users_public` ON `users` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_users_google` ON `users` (`google_sub`) WHERE google_sub <> '';