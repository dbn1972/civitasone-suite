import { pgSchema, uuid, varchar, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
const workflowSchema = pgSchema("workflow");

export const cases = workflowSchema.table("cases", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  caseNumber:      varchar("case_number", { length: 32 }).notNull(),
  title:           varchar("title", { length: 256 }).notNull(),
  caseType:        varchar("case_type", { length: 64 }).notNull(),
  status:          varchar("status", { length: 24 }).notNull().default("open"),
  priority:        varchar("priority", { length: 16 }).notNull().default("normal"),
  sourceService:   varchar("source_service", { length: 64 }).notNull(),
  sourceRefId:     uuid("source_ref_id").notNull(),
  assigneeId:      uuid("assignee_id"),
  parentCaseId:    uuid("parent_case_id"),
  mergedIntoCaseId: uuid("merged_into_case_id"),
  metadata:        jsonb("metadata").notNull().default({}),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt:      timestamp("resolved_at", { withTimezone: true }),
  createdBy:       uuid("created_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const caseDeviations = workflowSchema.table("case_deviations", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  caseId:      uuid("case_id").notNull(),
  type:        varchar("type", { length: 32 }).notNull(),
  description: text("description").notNull(),
  severity:    varchar("severity", { length: 16 }).notNull().default("medium"),
  status:      varchar("status", { length: 16 }).notNull().default("open"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
});

export const caseRegistrySchema = { cases, caseDeviations };
