import { pgSchema, uuid, text, integer, bigint, varchar, timestamp } from "drizzle-orm/pg-core";

export const observationSchema = pgSchema("observation");

export const auditObservations = observationSchema.table("audit_observations", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  obsNo:               text("obs_no").notNull(),
  planId:              uuid("plan_id"),
  auditeeRef:          text("auditee_ref").notNull(),
  finding:             text("finding").notNull(),
  category:            varchar("category", { length: 24 }).notNull().default("compliance"),
  riskLevel:           varchar("risk_level", { length: 16 }).notNull().default("medium"),
  amountInvolvedMinor: bigint("amount_involved_minor", { mode: "bigint" }).notNull().default(0n),
  status:              varchar("status", { length: 24 }).notNull().default("open"),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

export const auditWorkingPapers = observationSchema.table("audit_working_papers", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  observationId:  uuid("observation_id").notNull(),
  title:          text("title").notNull(),
  contentRef:     text("content_ref"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type ObservationRow = typeof auditObservations.$inferSelect;
export type ObservationInsert = typeof auditObservations.$inferInsert;
export const schema = { auditObservations, auditWorkingPapers };
