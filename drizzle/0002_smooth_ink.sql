CREATE TABLE `effects` (
	`id` text PRIMARY KEY NOT NULL,
	`room` text NOT NULL,
	`author` text NOT NULL,
	`payload` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`room`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_effects_room_at` ON `effects` (`room`,`at`);