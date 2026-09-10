CREATE TABLE `join_requests` (
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
CREATE INDEX `idx_join_requests_room` ON `join_requests` (`room`);--> statement-breakpoint
CREATE INDEX `idx_join_requests_session` ON `join_requests` (`session`);
