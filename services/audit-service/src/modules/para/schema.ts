import { pgSchema, uuid, text, integer, bigint, varchar, timestamp } from "drizzle-orm/pg-core";

export const paraSchema = pgSchema("para");

export const auditParas = paraSchema.table("audit_paras", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  paraNo:              text("para_no").notNull(),
  observationId:       uuid("observation_id"),
  deptRef:             text("dept_ref").notNull(),
  body:                text("body").notNull(),
  category:            varchar("category", { length: 24 }).notNull().default("compliance"),
  amountInvolvedMinor: bigint("amount_involved_minor", { mode: "bigint" }).notNull().default(0n),
  sourceRef:           text("source_ref"),
  status:              varchar("status", { length: 24 }).notNull().default("draft"),
  issuedAt:            timestamp("issued_at", { withTimezone: true }),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

export const auditDeptResponses = paraSchema.table("audit_dept_responses", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  paraId:          uuid("para_id").notNull(),
  responseBody:    text("response_body").notNull(),
  respondedByRef:  text("responded_by_ref").notNull(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const auditParaStatusHistory = paraSchema.table("audit_para_status_history", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  paraId:     uuid("para_id").notNull(),
  fromStatus: varchar("from_status", { length: 24 }).notNull(),
  toStatus:   varchar("to_status", { length: 24 }).notNull(),
  reason:     text("reason"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
});

export type ParaRow = typeof auditParas.$inferSelect;
export type ParaInsert = typeof auditParas.$inferInsert;
export type ParaStatus = "draft" | "issued" | "replied" | "settled" | "pending_recovery" | "closed";
export const schema = { auditParas, auditDeptResponses, auditParaStatusHistory };
