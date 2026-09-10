CREATE TABLE `members` (
	`room` text NOT NULL,
	`session` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`seen` integer NOT NULL,
	`pose` text NOT NULL,
	`ping` integer DEFAULT 0 NOT NULL,
	`mood` text DEFAULT '' NOT NULL,
	`hat` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`room`, `session`),
	FOREIGN KEY (`room`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_members_session` ON `members` (`session`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text NOT NULL,
	`state` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created` integer NOT NULL
);
