CREATE TABLE `workflow_artifacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`stepNumber` int,
	`runId` int,
	`iteration` int,
	`artifactType` enum('step_input','step_output','plan','draft','review','final','conversation_note','change_request','change_analysis','snapshot') NOT NULL,
	`source` enum('user','agent','system') NOT NULL DEFAULT 'system',
	`visibility` enum('user','agent','both') NOT NULL DEFAULT 'both',
	`title` varchar(180) NOT NULL,
	`content` text NOT NULL,
	`payload` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workflow_artifacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_artifacts_project_step_created` ON `workflow_artifacts` (`projectId`,`stepNumber`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_artifacts_project_type_created` ON `workflow_artifacts` (`projectId`,`artifactType`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_artifacts_run_iteration` ON `workflow_artifacts` (`runId`,`iteration`,`createdAt`);