ALTER TABLE `agent_runs` ADD `currentStage` enum('context','plan','draft','review','final','completed','error') DEFAULT 'context' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `currentIteration` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `stateSnapshot` json;