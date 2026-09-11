-- IF NOT EXISTS: older databases already got this table from the runtime bootstrap in db/server.ts.
-- The snapshot also records members.kills/deaths/assists/recent_damage/immune_until, but they are
-- not ALTERed here: existing databases already have them (SQLite has no ADD COLUMN IF NOT EXISTS),
-- so ensureCombatColumns() in db/combat.ts keeps adding them once per isolate on fresh databases.
CREATE TABLE IF NOT EXISTS `join_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`room` text NOT NULL,
	`session` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created` integer NOT NULL,
	`resolved_at` integer DEFAULT 0 NOT NULL,
	`resolved_by` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`room`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_join_requests_room` ON `join_requests` (`room`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_join_requests_session` ON `join_requests` (`session`);
