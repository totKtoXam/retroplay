CREATE TABLE `history` (
	`room` text NOT NULL,
	`version` integer NOT NULL,
	`author` text NOT NULL,
	`before` text NOT NULL,
	`action` text NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`room`, `version`),
	FOREIGN KEY (`room`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `members` ADD `cursor` text DEFAULT '{}' NOT NULL;