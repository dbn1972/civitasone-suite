import { pgSchema, uuid, varchar, integer, bigint, numeric, timestamp } from "drizzle-orm/pg-core";

const works = pgSchema("works");

export const workScopes = works.table("work_scopes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  scopeId: uuid("scope_id").notNull(),
  targetValue: numeric("target_value", { precision: 18, scale: 4 }),
  description: varchar("description", { length: 2048 }),
  plannedStart: timestamp("planned_start", { withTimezone: true }),
  plannedEnd: timestamp("planned_end", { withTimezone: true }),
  version: integer("version").notNull().default(1),
});

export const scopeProgress = works.table("scope_progress", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workScopeId: uuid("work_scope_id").notNull(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  priorAchievement: numeric("prior_achievement", { precision: 18, scale: 4 }),
  currentAchievement: numeric("current_achievement", { precision: 18, scale: 4 }),
  percentage: numeric("percentage", { precision: 5, scale: 2 }),
  version: integer("version").notNull().default(1),
});

export const physicalTargets = works.table("physical_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  boqItemId: uuid("boq_item_id"),
  financialYear: varchar("financial_year", { length: 16 }).notNull(),
  apr: numeric("apr", { precision: 18, scale: 4 }),
  may: numeric("may", { precision: 18, scale: 4 }),
  jun: numeric("jun", { precision: 18, scale: 4 }),
  jul: numeric("jul", { precision: 18, scale: 4 }),
  aug: numeric("aug", { precision: 18, scale: 4 }),
  sep: numeric("sep", { precision: 18, scale: 4 }),
  oct: numeric("oct", { precision: 18, scale: 4 }),
  nov: numeric("nov", { precision: 18, scale: 4 }),
  dec: numeric("dec", { precision: 18, scale: 4 }),
  jan: numeric("jan", { precision: 18, scale: 4 }),
  feb: numeric("feb", { precision: 18, scale: 4 }),
  mar: numeric("mar", { precision: 18, scale: 4 }),
  version: integer("version").notNull().default(1),
});

export const workPhotos = works.table("work_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  userId: uuid("user_id").notNull(),
  fileKey: varchar("file_key", { length: 512 }).notNull(),
  description: varchar("description", { length: 2048 }),
  captureDate: timestamp("capture_date", { withTimezone: true }),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  source: varchar("source", { length: 16 }), // mobile | web
  version: integer("version").notNull().default(1),
});

export const workIssues = works.table("work_issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  issueTypeId: uuid("issue_type_id"),
  forwardedTo: uuid("forwarded_to"),
  raisedDate: timestamp("raised_date", { withTimezone: true }).notNull(),
  description: varchar("description", { length: 2048 }).notNull(),
  attachmentKey: varchar("attachment_key", { length: 512 }),
  status: varchar("status", { length: 16 }).notNull().default("open"), // open | closed
  closedDate: timestamp("closed_date", { withTimezone: true }),
  version: integer("version").notNull().default(1),
});

export const issueObservations = works.table("issue_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  issueId: uuid("issue_id").notNull(),
  observation: varchar("observation", { length: 2048 }).notNull(),
  attachmentKey: varchar("attachment_key", { length: 512 }),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const financialTargets = works.table("financial_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  budgetYear: varchar("budget_year", { length: 16 }).notNull(),
  month: integer("month").notNull(),
  cumulativeTarget: bigint("cumulative_target", { mode: "bigint" }).notNull(),
  version: integer("version").notNull().default(1),
});

export const physicalCompletions = works.table("physical_completions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  completionDate: timestamp("completion_date", { withTimezone: true }).notNull(),
  certificateFileKey: varchar("certificate_file_key", { length: 512 }),
  completedBy: uuid("completed_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const workClosures = works.table("work_closures", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  closureType: varchar("closure_type", { length: 16 }).notNull(), // closed|dropped|completion
  closedDate: timestamp("closed_date", { withTimezone: true }).notNull(),
  remarks: varchar("remarks", { length: 2048 }),
  version: integer("version").notNull().default(1),
});

export const schema = {
  workScopes, scopeProgress, physicalTargets, workPhotos, workIssues,
  issueObservations, financialTargets, physicalCompletions, workClosures,
};
