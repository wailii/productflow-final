ALTER TABLE `workflow_steps` ADD CONSTRAINT `uidx_workflow_steps_project_step` UNIQUE(`projectId`,`stepNumber`);--> statement-breakpoint
CREATE INDEX `idx_conversation_project_step_created` ON `conversation_history` (`projectId`,`stepNumber`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_projects_user_updated` ON `projects` (`userId`,`updatedAt`);