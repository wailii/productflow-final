CREATE TABLE `local_credentials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `local_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `uidx_local_credentials_user` UNIQUE(`userId`)
);
