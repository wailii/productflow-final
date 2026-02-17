CREATE TABLE `workflow_assets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`stepNumber` int,
	`assetType` enum('document','image','prototype','other') NOT NULL DEFAULT 'other',
	`scope` enum('project','step') NOT NULL DEFAULT 'project',
	`fileName` varchar(255) NOT NULL,
	`mimeType` varchar(160) NOT NULL,
	`fileSize` int NOT NULL,
	`storageKey` varchar(500) NOT NULL,
	`sourceLabel` varchar(120),
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workflow_assets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_assets_project_step_created` ON `workflow_assets` (`projectId`,`stepNumber`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_assets_project_type_created` ON `workflow_assets` (`projectId`,`assetType`,`createdAt`);