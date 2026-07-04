// =============================================================================
//  Outil de gestion d'horaire — schéma Drizzle ORM (MySQL)
// =============================================================================
//
//  Reflète toutes les décisions de conception, dont les plus récentes :
//   - PK entières AUTO-INCREMENTÉES (idTable) ; FK entières (tableId)
//   - Drizzle plutôt que Prisma (SQL-first, typé, CHECK dans le schéma)
//   - `recurrenceStart` sur `item` (l'ancre DTSTART, séparée de la `rrule`)
//   - Tâches éphémères = tâches du projet par défaut « Liste de tâches »
//     (convention produit, projectId reste nullable au niveau schéma)
//
//  Rappels du modèle :
//   - `item` = définition ; `itemOccurrence` = état d'une instance
//   - occurrences futures VIRTUELLES (calculées depuis rrule + recurrenceStart)
//   - `timeBlock` = prévu (n par occurrence = découpage) ; `timeLog` = réel
//   - définitionnel -> workspace ; ordonnancement (timeBlock/timeLog) -> user
//
//  À AJOUTER EN MIGRATION SQL BRUTE (voir fichier de migration séparé) :
//   - prévention de cycles : category, project, itemDependency
//   - intégrité même-workspace (item.projectId, catégories liées)
//   - FK pour createdBy / updatedBy vers user (gardés en colonnes simples ici)
// =============================================================================

import {
  mysqlTable, mysqlEnum, int, varchar, text, boolean,
  datetime, decimal, timestamp, index, uniqueIndex, check,
  type AnyMySqlColumn,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

// ----------------------------------------------------------------------------
//  Fragments réutilisés
// ----------------------------------------------------------------------------

// Colonnes d'audit communes à toutes les tables.
// createdBy / updatedBy : colonnes simples (FK vers user posée en migration)
// pour ne pas alourdir le modèle d'une vingtaine de relations inverses.
const audit = {
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
  createdBy: int('createdBy'),
  updatedBy: int('updatedBy'),
};

// ----------------------------------------------------------------------------
//  Comptes & tenancy
// ----------------------------------------------------------------------------

export const user = mysqlTable('user', {
  idUser:         int('idUser').autoincrement().primaryKey(),
  email:          varchar('email', { length: 255 }).notNull().unique(),
  externalAuthId: varchar('externalAuthId', { length: 255 }).unique(),
  createdAt:      timestamp('createdAt').defaultNow().notNull(),
  updatedAt:      timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
});

export const workspace = mysqlTable('workspace', {
  idWorkspace: int('idWorkspace').autoincrement().primaryKey(),
  name:        varchar('name', { length: 255 }).notNull(),
  ...audit,
});

export const workspaceUser = mysqlTable('workspaceUser', {
  idWorkspaceUser: int('idWorkspaceUser').autoincrement().primaryKey(),
  workspaceId:     int('workspaceId').notNull().references(() => workspace.idWorkspace, { onDelete: 'cascade' }),
  userId:          int('userId').notNull().references(() => user.idUser, { onDelete: 'cascade' }),
  role:            mysqlEnum('role', ['owner', 'admin', 'member']).default('member').notNull(),
  ...audit,
}, (t) => [
  uniqueIndex('workspaceUser_unique').on(t.workspaceId, t.userId),
  index('workspaceUser_user_idx').on(t.userId),
]);

// ----------------------------------------------------------------------------
//  Organisation : catégories (tags hiérarchiques) & projets (hiérarchiques)
// ----------------------------------------------------------------------------

export const category = mysqlTable('category', {
  idCategory:       int('idCategory').autoincrement().primaryKey(),
  workspaceId:      int('workspaceId').notNull().references(() => workspace.idWorkspace, { onDelete: 'cascade' }),
  parentCategoryId: int('parentCategoryId').references((): AnyMySqlColumn => category.idCategory, { onDelete: 'set null' }),
  name:             varchar('name', { length: 255 }).notNull(),
  color:            varchar('color', { length: 30 }).notNull(),
  ...audit,
}, (t) => [
  index('category_workspace_idx').on(t.workspaceId),
  index('category_parent_idx').on(t.parentCategoryId),
]);

export const project = mysqlTable('project', {
  idProject:       int('idProject').autoincrement().primaryKey(),
  workspaceId:     int('workspaceId').notNull().references(() => workspace.idWorkspace, { onDelete: 'cascade' }),
  parentProjectId: int('parentProjectId').references((): AnyMySqlColumn => project.idProject, { onDelete: 'set null' }),
  name:            varchar('name', { length: 255 }).notNull(),
  color:           varchar('color', { length: 30 }).notNull(),
  income:          decimal('income', { precision: 10, scale: 2 }).default('0').notNull(),
  status:          mysqlEnum('status', ['active', 'onHold', 'done', 'cancelled', 'archived']).default('active').notNull(),
  ...audit,
}, (t) => [
  index('project_workspace_idx').on(t.workspaceId),
  index('project_parent_idx').on(t.parentProjectId),
]);

// ----------------------------------------------------------------------------
//  Items (la définition) & leurs occurrences (l'état)
// ----------------------------------------------------------------------------

export const item = mysqlTable('item', {
  idItem:           int('idItem').autoincrement().primaryKey(),
  workspaceId:      int('workspaceId').notNull().references(() => workspace.idWorkspace, { onDelete: 'cascade' }),
  type:             mysqlEnum('type', ['task', 'event']).notNull(),
  projectId:        int('projectId').references(() => project.idProject, { onDelete: 'restrict' }),
  title:            varchar('title', { length: 255 }).notNull(),
  description:      text('description'),
  color:            varchar('color', { length: 30 }),
  estimatedMinutes: int('estimatedMinutes'),
  // Récurrence : les deux vont ensemble (null ensemble ou remplis ensemble)
  rrule:            varchar('rrule', { length: 1000 }),          // motif RFC 5545 (sans DTSTART)
  recurrenceStart:  datetime('recurrenceStart', { mode: 'date' }), // ancre DTSTART
  ...audit,
}, (t) => [
  index('item_workspace_idx').on(t.workspaceId),
  index('item_project_idx').on(t.projectId),
  check(
    'item_recurrence_pairing',
    sql`(${t.rrule} IS NULL AND ${t.recurrenceStart} IS NULL) OR (${t.rrule} IS NOT NULL AND ${t.recurrenceStart} IS NOT NULL)`,
  ),
]);

export const itemOccurrence = mysqlTable('itemOccurrence', {
  idItemOccurrence: int('idItemOccurrence').autoincrement().primaryKey(),
  itemId:           int('itemId').notNull().references(() => item.idItem, { onDelete: 'cascade' }),
  occurrenceDate:   datetime('occurrenceDate', { mode: 'date' }), // ancre de slot ; null si non récurrent
  status:           mysqlEnum('status', ['todo', 'doing', 'done', 'cancelled']).default('todo').notNull(),
  dueDate:          datetime('dueDate', { mode: 'date' }),        // null pour un event
  ...audit,
}, (t) => [
  uniqueIndex('itemOccurrence_slot_unique').on(t.itemId, t.occurrenceDate),
  index('itemOccurrence_reminder_idx').on(t.status, t.dueDate), // moteur de rappels
]);

// ----------------------------------------------------------------------------
//  Horaire : prévu (timeBlock) & réel (timeLog) — personnels (userId)
// ----------------------------------------------------------------------------

export const timeBlock = mysqlTable('timeBlock', {
  idTimeBlock:      int('idTimeBlock').autoincrement().primaryKey(),
  itemOccurrenceId: int('itemOccurrenceId').notNull().references(() => itemOccurrence.idItemOccurrence, { onDelete: 'cascade' }),
  userId:           int('userId').notNull().references(() => user.idUser, { onDelete: 'cascade' }),
  timeStart:        datetime('timeStart', { mode: 'date' }).notNull(),
  timeEnd:          datetime('timeEnd', { mode: 'date' }).notNull(),
  allDay:           boolean('allDay').default(false).notNull(),
  isBlocking:       boolean('isBlocking').default(false).notNull(),
  ...audit,
}, (t) => [
  index('timeBlock_occurrence_idx').on(t.itemOccurrenceId),
  index('timeBlock_user_time_idx').on(t.userId, t.timeStart), // rendu calendrier
]);

export const timeLog = mysqlTable('timeLog', {
  idTimeLog:        int('idTimeLog').autoincrement().primaryKey(),
  itemOccurrenceId: int('itemOccurrenceId').notNull().references(() => itemOccurrence.idItemOccurrence, { onDelete: 'cascade' }),
  userId:           int('userId').notNull().references(() => user.idUser, { onDelete: 'cascade' }),
  startedAt:        datetime('startedAt', { mode: 'date' }).notNull(),
  endedAt:          datetime('endedAt', { mode: 'date' }), // null = chrono en cours
  source:           mysqlEnum('source', ['timer', 'manual']).default('timer').notNull(),
  ...audit,
}, (t) => [
  index('timeLog_occurrence_idx').on(t.itemOccurrenceId),
  index('timeLog_user_time_idx').on(t.userId, t.startedAt),
]);

// ----------------------------------------------------------------------------
//  Graphes : dépendances entre items & jonctions de tags
// ----------------------------------------------------------------------------

export const itemDependency = mysqlTable('itemDependency', {
  idItemDependency: int('idItemDependency').autoincrement().primaryKey(),
  itemId:           int('itemId').notNull().references(() => item.idItem, { onDelete: 'cascade' }),           // le dépendant
  dependsOnItemId:  int('dependsOnItemId').notNull().references(() => item.idItem, { onDelete: 'cascade' }),  // le prérequis
  ...audit,
}, (t) => [
  uniqueIndex('itemDependency_unique').on(t.itemId, t.dependsOnItemId),
  index('itemDependency_prereq_idx').on(t.dependsOnItemId),
  check('no_self_dependency', sql`${t.itemId} <> ${t.dependsOnItemId}`),
]);

export const itemCategory = mysqlTable('itemCategory', {
  idItemCategory: int('idItemCategory').autoincrement().primaryKey(),
  itemId:         int('itemId').notNull().references(() => item.idItem, { onDelete: 'cascade' }),
  categoryId:     int('categoryId').notNull().references(() => category.idCategory, { onDelete: 'cascade' }),
  createdAt:      timestamp('createdAt').defaultNow().notNull(),
  createdBy:      int('createdBy'),
}, (t) => [
  uniqueIndex('itemCategory_unique').on(t.itemId, t.categoryId),
  index('itemCategory_category_idx').on(t.categoryId),
]);

export const projectCategory = mysqlTable('projectCategory', {
  idProjectCategory: int('idProjectCategory').autoincrement().primaryKey(),
  projectId:         int('projectId').notNull().references(() => project.idProject, { onDelete: 'cascade' }),
  categoryId:        int('categoryId').notNull().references(() => category.idCategory, { onDelete: 'cascade' }),
  createdAt:         timestamp('createdAt').defaultNow().notNull(),
  createdBy:         int('createdBy'),
}, (t) => [
  uniqueIndex('projectCategory_unique').on(t.projectId, t.categoryId),
  index('projectCategory_category_idx').on(t.categoryId),
]);

// ----------------------------------------------------------------------------
//  Types inférés (pratiques pour la couche API)
// ----------------------------------------------------------------------------

export type Item = typeof item.$inferSelect;
export type NewItem = typeof item.$inferInsert;
export type ItemOccurrence = typeof itemOccurrence.$inferSelect;
export type NewItemOccurrence = typeof itemOccurrence.$inferInsert;
export type TimeBlock = typeof timeBlock.$inferSelect;
export type TimeLog = typeof timeLog.$inferSelect;
export type Project = typeof project.$inferSelect;
export type Category = typeof category.$inferSelect;

// NOTE : les "relational queries" (db.query...) sont en transition vers la v1
// de Drizzle. Les jointures via .leftJoin() fonctionnent sans configuration et
// restent stables ; on ajoutera les relations() selon la version retenue.