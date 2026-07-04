CREATE FUNCTION `categoryCreatesCycle`(newChildId INT, newParentId INT)
RETURNS BOOLEAN
DETERMINISTIC
READS SQL DATA
BEGIN
  DECLARE cursorId INT;
  IF newParentId IS NULL THEN
    RETURN FALSE;
  END IF;
  SET cursorId = newParentId;
  WHILE cursorId IS NOT NULL DO
    IF cursorId = newChildId THEN
      RETURN TRUE;
    END IF;
    SELECT parentCategoryId INTO cursorId FROM category WHERE idCategory = cursorId;
  END WHILE;
  RETURN FALSE;
END
--> statement-breakpoint
CREATE FUNCTION `projectCreatesCycle`(newChildId INT, newParentId INT)
RETURNS BOOLEAN
DETERMINISTIC
READS SQL DATA
BEGIN
  DECLARE cursorId INT;
  IF newParentId IS NULL THEN
    RETURN FALSE;
  END IF;
  SET cursorId = newParentId;
  WHILE cursorId IS NOT NULL DO
    IF cursorId = newChildId THEN
      RETURN TRUE;
    END IF;
    SELECT parentProjectId INTO cursorId FROM project WHERE idProject = cursorId;
  END WHILE;
  RETURN FALSE;
END
--> statement-breakpoint
CREATE TRIGGER `category_no_cycle_insert` BEFORE INSERT ON `category`
FOR EACH ROW
BEGIN
  IF categoryCreatesCycle(NEW.idCategory, NEW.parentCategoryId) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Category hierarchy cycle detected.';
  END IF;
END
--> statement-breakpoint
CREATE TRIGGER `category_no_cycle_update` BEFORE UPDATE ON `category`
FOR EACH ROW
BEGIN
  IF categoryCreatesCycle(NEW.idCategory, NEW.parentCategoryId) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Category hierarchy cycle detected.';
  END IF;
END
--> statement-breakpoint
CREATE TRIGGER `project_no_cycle_insert` BEFORE INSERT ON `project`
FOR EACH ROW
BEGIN
  IF projectCreatesCycle(NEW.idProject, NEW.parentProjectId) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Project hierarchy cycle detected.';
  END IF;
END
--> statement-breakpoint
CREATE TRIGGER `project_no_cycle_update` BEFORE UPDATE ON `project`
FOR EACH ROW
BEGIN
  IF projectCreatesCycle(NEW.idProject, NEW.parentProjectId) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Project hierarchy cycle detected.';
  END IF;
END
--> statement-breakpoint
CREATE TRIGGER `itemCategory_same_workspace_insert` BEFORE INSERT ON `itemCategory`
FOR EACH ROW
BEGIN
  IF (SELECT workspaceId FROM item WHERE idItem = NEW.itemId)
     <> (SELECT workspaceId FROM category WHERE idCategory = NEW.categoryId) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Item and category must share the same workspace.';
  END IF;
END
--> statement-breakpoint
CREATE TRIGGER `projectCategory_same_workspace_insert` BEFORE INSERT ON `projectCategory`
FOR EACH ROW
BEGIN
  IF (SELECT workspaceId FROM project WHERE idProject = NEW.projectId)
     <> (SELECT workspaceId FROM category WHERE idCategory = NEW.categoryId) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Project and category must share the same workspace.';
  END IF;
END
--> statement-breakpoint
CREATE TRIGGER `item_same_workspace_as_project_insert` BEFORE INSERT ON `item`
FOR EACH ROW
BEGIN
  IF NEW.projectId IS NOT NULL
     AND (SELECT workspaceId FROM project WHERE idProject = NEW.projectId) <> NEW.workspaceId THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Item and its project must share the same workspace.';
  END IF;
END
--> statement-breakpoint
CREATE TRIGGER `itemDependency_same_workspace_insert` BEFORE INSERT ON `itemDependency`
FOR EACH ROW
BEGIN
  IF (SELECT workspaceId FROM item WHERE idItem = NEW.itemId)
     <> (SELECT workspaceId FROM item WHERE idItem = NEW.dependsOnItemId) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Both items of a dependency must share the same workspace.';
  END IF;
END