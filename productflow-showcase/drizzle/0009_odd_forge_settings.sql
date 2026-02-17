CREATE TABLE `user_ai_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`providerId` varchar(64) NOT NULL,
	`baseUrl` varchar(500) NOT NULL,
	`model` varchar(180) NOT NULL,
	`apiKeyEncrypted` text,
	`enabled` tinyint NOT NULL DEFAULT 0,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_ai_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `uidx_user_ai_settings_user` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE INDEX `idx_user_ai_settings_provider` ON `user_ai_settings` (`providerId`);
