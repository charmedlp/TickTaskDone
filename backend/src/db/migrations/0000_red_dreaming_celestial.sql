CREATE TABLE `category` (
	`idCategory` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`parentCategoryId` int,
	`name` varchar(255) NOT NULL,
	`color` varchar(30) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdBy` int,
	`updatedBy` int,
	CONSTRAINT `category_idCategory` PRIMARY KEY(`idCategory`)
);
--> statement-breakpoint
CREATE TABLE `item` (
	`idItem` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`type` enum('task','event') NOT NULL,
	`projectId` int,
	`title` varchar(255) NOT NULL,
	`description` text,
	`color` varchar(30),
	`estimatedMinutes` int,
	`rrule` varchar(1000),
	`recurrenceStart` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdBy` int,
	`updatedBy` int,
	CONSTRAINT `item_idItem` PRIMARY KEY(`idItem`),
	CONSTRAINT `item_recurrence_pairing` CHECK((`item`.`rrule` IS NULL AND `item`.`recurrenceStart` IS NULL) OR (`item`.`rrule` IS NOT NULL AND `item`.`recurrenceStart` IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `itemCategory` (
	`idItemCategory` int AUTO_INCREMENT NOT NULL,
	`itemId` int NOT NULL,
	`categoryId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`createdBy` int,
	CONSTRAINT `itemCategory_idItemCategory` PRIMARY KEY(`idItemCategory`),
	CONSTRAINT `itemCategory_unique` UNIQUE(`itemId`,`categoryId`)
);
--> statement-breakpoint
CREATE TABLE `itemDependency` (
	`idItemDependency` int AUTO_INCREMENT NOT NULL,
	`itemId` int NOT NULL,
	`dependsOnItemId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdBy` int,
	`updatedBy` int,
	CONSTRAINT `itemDependency_idItemDependency` PRIMARY KEY(`idItemDependency`),
	CONSTRAINT `itemDependency_unique` UNIQUE(`itemId`,`dependsOnItemId`),
	CONSTRAINT `no_self_dependency` CHECK(`itemDependency`.`itemId` <> `itemDependency`.`dependsOnItemId`)
);
--> statement-breakpoint
CREATE TABLE `itemOccurrence` (
	`idItemOccurrence` int AUTO_INCREMENT NOT NULL,
	`itemId` int NOT NULL,
	`occurrenceDate` datetime,
	`status` enum('todo','doing','done','cancelled') NOT NULL DEFAULT 'todo',
	`dueDate` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdBy` int,
	`updatedBy` int,
	CONSTRAINT `itemOccurrence_idItemOccurrence` PRIMARY KEY(`idItemOccurrence`),
	CONSTRAINT `itemOccurrence_slot_unique` UNIQUE(`itemId`,`occurrenceDate`)
);
--> statement-breakpoint
CREATE TABLE `project` (
	`idProject` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`parentProjectId` int,
	`name` varchar(255) NOT NULL,
	`color` varchar(30) NOT NULL,
	`income` decimal(10,2) NOT NULL DEFAULT '0',
	`status` enum('active','onHold','done','cancelled','archived') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdBy` int,
	`updatedBy` int,
	CONSTRAINT `project_idProject` PRIMARY KEY(`idProject`)
);
--> statement-breakpoint
CREATE TABLE `projectCategory` (
	`idProjectCategory` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`categoryId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`createdBy` int,
	CONSTRAINT `projectCategory_idProjectCategory` PRIMARY KEY(`idProjectCategory`),
	CONSTRAINT `projectCategory_unique` UNIQUE(`projectId`,`categoryId`)
);
--> statement-breakpoint
CREATE TABLE `timeBlock` (
	`idTimeBlock` int AUTO_INCREMENT NOT NULL,
	`itemOccurrenceId` int NOT NULL,
	`userId` int NOT NULL,
	`timeStart` datetime NOT NULL,
	`timeEnd` datetime NOT NULL,
	`allDay` boolean NOT NULL DEFAULT false,
	`isBlocking` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdBy` int,
	`updatedBy` int,
	CONSTRAINT `timeBlock_idTimeBlock` PRIMARY KEY(`idTimeBlock`)
);
--> statement-breakpoint
CREATE TABLE `timeLog` (
	`idTimeLog` int AUTO_INCREMENT NOT NULL,
	`itemOccurrenceId` int NOT NULL,
	`userId` int NOT NULL,
	`startedAt` datetime NOT NULL,
	`endedAt` datetime,
	`source` enum('timer','manual') NOT NULL DEFAULT 'timer',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdBy` int,
	`updatedBy` int,
	CONSTRAINT `timeLog_idTimeLog` PRIMARY KEY(`idTimeLog`)
);
--> statement-breakpoint
CREATE TABLE `user` (
	`idUser` int AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`externalAuthId` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_idUser` PRIMARY KEY(`idUser`),
	CONSTRAINT `user_email_unique` UNIQUE(`email`),
	CONSTRAINT `user_externalAuthId_unique` UNIQUE(`externalAuthId`)
);
--> statement-breakpoint
CREATE TABLE `workspace` (
	`idWorkspace` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdBy` int,
	`updatedBy` int,
	CONSTRAINT `workspace_idWorkspace` PRIMARY KEY(`idWorkspace`)
);
--> statement-breakpoint
CREATE TABLE `workspaceUser` (
	`idWorkspaceUser` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('owner','admin','member') NOT NULL DEFAULT 'member',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdBy` int,
	`updatedBy` int,
	CONSTRAINT `workspaceUser_idWorkspaceUser` PRIMARY KEY(`idWorkspaceUser`),
	CONSTRAINT `workspaceUser_unique` UNIQUE(`workspaceId`,`userId`)
);
--> statement-breakpoint
ALTER TABLE `category` ADD CONSTRAINT `category_workspaceId_workspace_idWorkspace_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`idWorkspace`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `category` ADD CONSTRAINT `category_parentCategoryId_category_idCategory_fk` FOREIGN KEY (`parentCategoryId`) REFERENCES `category`(`idCategory`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `item` ADD CONSTRAINT `item_workspaceId_workspace_idWorkspace_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`idWorkspace`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `item` ADD CONSTRAINT `item_projectId_project_idProject_fk` FOREIGN KEY (`projectId`) REFERENCES `project`(`idProject`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `itemCategory` ADD CONSTRAINT `itemCategory_itemId_item_idItem_fk` FOREIGN KEY (`itemId`) REFERENCES `item`(`idItem`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `itemCategory` ADD CONSTRAINT `itemCategory_categoryId_category_idCategory_fk` FOREIGN KEY (`categoryId`) REFERENCES `category`(`idCategory`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `itemDependency` ADD CONSTRAINT `itemDependency_itemId_item_idItem_fk` FOREIGN KEY (`itemId`) REFERENCES `item`(`idItem`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `itemDependency` ADD CONSTRAINT `itemDependency_dependsOnItemId_item_idItem_fk` FOREIGN KEY (`dependsOnItemId`) REFERENCES `item`(`idItem`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `itemOccurrence` ADD CONSTRAINT `itemOccurrence_itemId_item_idItem_fk` FOREIGN KEY (`itemId`) REFERENCES `item`(`idItem`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project` ADD CONSTRAINT `project_workspaceId_workspace_idWorkspace_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`idWorkspace`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project` ADD CONSTRAINT `project_parentProjectId_project_idProject_fk` FOREIGN KEY (`parentProjectId`) REFERENCES `project`(`idProject`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projectCategory` ADD CONSTRAINT `projectCategory_projectId_project_idProject_fk` FOREIGN KEY (`projectId`) REFERENCES `project`(`idProject`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projectCategory` ADD CONSTRAINT `projectCategory_categoryId_category_idCategory_fk` FOREIGN KEY (`categoryId`) REFERENCES `category`(`idCategory`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeBlock` ADD CONSTRAINT `timeBlock_itemOccurrenceId_itemOccurrence_idItemOccurrence_fk` FOREIGN KEY (`itemOccurrenceId`) REFERENCES `itemOccurrence`(`idItemOccurrence`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeBlock` ADD CONSTRAINT `timeBlock_userId_user_idUser_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`idUser`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeLog` ADD CONSTRAINT `timeLog_itemOccurrenceId_itemOccurrence_idItemOccurrence_fk` FOREIGN KEY (`itemOccurrenceId`) REFERENCES `itemOccurrence`(`idItemOccurrence`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeLog` ADD CONSTRAINT `timeLog_userId_user_idUser_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`idUser`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspaceUser` ADD CONSTRAINT `workspaceUser_workspaceId_workspace_idWorkspace_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`idWorkspace`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspaceUser` ADD CONSTRAINT `workspaceUser_userId_user_idUser_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`idUser`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `category_workspace_idx` ON `category` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `category_parent_idx` ON `category` (`parentCategoryId`);--> statement-breakpoint
CREATE INDEX `item_workspace_idx` ON `item` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `item_project_idx` ON `item` (`projectId`);--> statement-breakpoint
CREATE INDEX `itemCategory_category_idx` ON `itemCategory` (`categoryId`);--> statement-breakpoint
CREATE INDEX `itemDependency_prereq_idx` ON `itemDependency` (`dependsOnItemId`);--> statement-breakpoint
CREATE INDEX `itemOccurrence_reminder_idx` ON `itemOccurrence` (`status`,`dueDate`);--> statement-breakpoint
CREATE INDEX `project_workspace_idx` ON `project` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `project_parent_idx` ON `project` (`parentProjectId`);--> statement-breakpoint
CREATE INDEX `projectCategory_category_idx` ON `projectCategory` (`categoryId`);--> statement-breakpoint
CREATE INDEX `timeBlock_occurrence_idx` ON `timeBlock` (`itemOccurrenceId`);--> statement-breakpoint
CREATE INDEX `timeBlock_user_time_idx` ON `timeBlock` (`userId`,`timeStart`);--> statement-breakpoint
CREATE INDEX `timeLog_occurrence_idx` ON `timeLog` (`itemOccurrenceId`);--> statement-breakpoint
CREATE INDEX `timeLog_user_time_idx` ON `timeLog` (`userId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `workspaceUser_user_idx` ON `workspaceUser` (`userId`);