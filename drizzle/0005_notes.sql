-- Board cards move out of rooms.state into one row each (lib/room-store.ts).
-- No data is copied here: a room keeps its inline `notes` until its next write moves them,
-- so the old server that keeps running during a deploy is not affected by this migration.
CREATE TABLE IF NOT EXISTS `notes` (
	`room` text NOT NULL,
	`id` text NOT NULL,
	`position` integer NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`room`, `id`),
	FOREIGN KEY (`room`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
