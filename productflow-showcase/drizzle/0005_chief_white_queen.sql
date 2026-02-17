CREATE TABLE `agent_actions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` int NOT NULL,
	`projectId` int NOT NULL,
	`stepNumber` int NOT NULL,
	`actionType` enum('context','plan','draft','review','final','error') NOT NULL,
	`title` varchar(120) NOT NULL,
	`content` text NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_actions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`stepNumber` int NOT NULL,
	`strategy` varchar(64) NOT NULL DEFAULT 'loop-v1',
	`status` enum('running','completed','error') NOT NULL DEFAULT 'running',
	`finalOutput` json,
	`errorMessage` text,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`finishedAt` timestamp,
	CONSTRAINT `agent_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_agent_actions_run_created` ON `agent_actions` (`runId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_agent_actions_project_step_created` ON `agent_actions` (`projectId`,`stepNumber`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_agent_runs_project_step_started` ON `agent_runs` (`projectId`,`stepNumber`,`startedAt`);