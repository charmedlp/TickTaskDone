ALTER TABLE `workspace` ADD CONSTRAINT `workspace_createdBy_user_fk` FOREIGN KEY (`createdBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `workspace` ADD CONSTRAINT `workspace_updatedBy_user_fk` FOREIGN KEY (`updatedBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `workspaceUser` ADD CONSTRAINT `workspaceUser_createdBy_user_fk` FOREIGN KEY (`createdBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `workspaceUser` ADD CONSTRAINT `workspaceUser_updatedBy_user_fk` FOREIGN KEY (`updatedBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `category` ADD CONSTRAINT `category_createdBy_user_fk` FOREIGN KEY (`createdBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `category` ADD CONSTRAINT `category_updatedBy_user_fk` FOREIGN KEY (`updatedBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `project` ADD CONSTRAINT `project_createdBy_user_fk` FOREIGN KEY (`createdBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `project` ADD CONSTRAINT `project_updatedBy_user_fk` FOREIGN KEY (`updatedBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `item` ADD CONSTRAINT `item_createdBy_user_fk` FOREIGN KEY (`createdBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `item` ADD CONSTRAINT `item_updatedBy_user_fk` FOREIGN KEY (`updatedBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `itemOccurrence` ADD CONSTRAINT `itemOccurrence_createdBy_user_fk` FOREIGN KEY (`createdBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `itemOccurrence` ADD CONSTRAINT `itemOccurrence_updatedBy_user_fk` FOREIGN KEY (`updatedBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `timeBlock` ADD CONSTRAINT `timeBlock_createdBy_user_fk` FOREIGN KEY (`createdBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `timeBlock` ADD CONSTRAINT `timeBlock_updatedBy_user_fk` FOREIGN KEY (`updatedBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `timeLog` ADD CONSTRAINT `timeLog_createdBy_user_fk` FOREIGN KEY (`createdBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `timeLog` ADD CONSTRAINT `timeLog_updatedBy_user_fk` FOREIGN KEY (`updatedBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `itemDependency` ADD CONSTRAINT `itemDependency_createdBy_user_fk` FOREIGN KEY (`createdBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `itemDependency` ADD CONSTRAINT `itemDependency_updatedBy_user_fk` FOREIGN KEY (`updatedBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `itemCategory` ADD CONSTRAINT `itemCategory_createdBy_user_fk` FOREIGN KEY (`createdBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `projectCategory` ADD CONSTRAINT `projectCategory_createdBy_user_fk` FOREIGN KEY (`createdBy`) REFERENCES `user`(`idUser`) ON DELETE SET NULL;