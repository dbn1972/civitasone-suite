import { pgSchema, uuid, text, integer, bigint, char, varchar, numeric, timestamp, date, boolean } from "drizzle-orm/pg-core";

export const projectSchema = pgSchema("project");

export const projectProjects = projectSchema.table("project_projects", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  code:             text("code").notNull(),
  name:             text("name").notNull(),
  schemeId:         uuid("scheme_id"),
  agencyRef:        text("agency_ref"),
  dprCostMinor:     bigint("dpr_cost_minor", { mode: "bigint" }).notNull().default(0n),
  sanctionedMinor:  bigint("sanctioned_minor", { mode: "bigint" }).notNull().default(0n),
  sanctionRef:      text("sanction_ref"),
  currency:         char("currency", { length: 3 }).notNull().default("INR"),
  status:           varchar("status", { length: 24 }).notNull().default("planned"),
  startDate:        date("start_date"),
  endDate:          date("end_date"),
  physicalPct:      numeric("physical_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  financialPct:     numeric("financial_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  rag:              varchar("rag", { length: 16 }).notNull().default("green"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export const projectTasks = projectSchema.table("project_tasks", {
  id:             uuid("id").primaryKey().defaultRandom(),
  projectId:      uuid("project_id").notNull(),
  tenantId:       uuid("tenant_id").notNull(),
  parentTaskId:   uuid("parent_task_id"),
  name:           text("name").notNull(),
  description:    text("description"),
  weightPct:      numeric("weight_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  status:         varchar("status", { length: 24 }).notNull().default("pending"),
  plannedStart:   date("planned_start"),
  plannedEnd:     date("planned_end"),
  actualStart:    date("actual_start"),
  actualEnd:      date("actual_end"),
  progressPct:    numeric("progress_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const projectMilestones = projectSchema.table("project_milestones", {
  id:            uuid("id").primaryKey().defaultRandom(),
  projectId:     uuid("project_id").notNull(),
  tenantId:      uuid("tenant_id").notNull(),
  name:          text("name").notNull(),
  plannedDate:   date("planned_date").notNull(),
  actualDate:    date("actual_date"),
  paymentMinor:  bigint("payment_minor", { mode: "bigint" }).notNull().default(0n),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  status:        varchar("status", { length: 24 }).notNull().default("pending"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const projectMembers = projectSchema.table("project_members", {
  id:          uuid("id").primaryKey().defaultRandom(),
  projectId:   uuid("project_id").notNull(),
  tenantId:    uuid("tenant_id").notNull(),
  userId:      uuid("user_id").notNull(),
  role:        varchar("role", { length: 64 }).notNull().default("member"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const projectMilestoneEvidence = projectSchema.table("milestone_evidence", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  milestoneId:  uuid("milestone_id").notNull(),
  fileKey:      varchar("file_key", { length: 1024 }).notNull(),
  fileName:     varchar("file_name", { length: 512 }),
  uploadedAt:   timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  uploadedBy:   uuid("uploaded_by").notNull(),
});

export type ProjectRow    = typeof projectProjects.$inferSelect;
export type ProjectInsert = typeof projectProjects.$inferInsert;
export type TaskRow       = typeof projectTasks.$inferSelect;
export type TaskInsert    = typeof projectTasks.$inferInsert;
export type MilestoneRow  = typeof projectMilestones.$inferSelect;

export const schema = { projectProjects, projectTasks, projectMilestones, projectMembers, projectMilestoneEvidence };
