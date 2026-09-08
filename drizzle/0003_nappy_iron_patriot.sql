ALTER TABLE `effects` ADD `applied` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `effects` ADD `resolve_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `hp` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `respawn_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `life` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `last_shot` integer DEFAULT 0 NOT NULL;