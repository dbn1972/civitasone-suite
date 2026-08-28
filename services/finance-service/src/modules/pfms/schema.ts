import { pgSchema, uuid, varchar, timestamp } from "drizzle-orm/pg-core";

export const pfmsSchema = pgSchema("payments");

// createdBy/updatedBy were never part of migrations/0008_pfms_phase2.sql's
// CREATE TABLE — selecting them here makes every query against this table
// throw a live Postgres "column does not exist" (42703), which surfaces to
// callers as a 500 on GET /v1/finance/pfms/config, masked by ConfigPanel's
// confident-but-wrong "not configured" empty state. Dropped to match the
// real table rather than adding a migration for columns nothing ever wrote.
export const financePfmsConfig = pfmsSchema.table("finance_pfms_config", {
  tenantId:    uuid("tenant_id").primaryKey(),
  agencyCode:  varchar("agency_code", { length: 12 }).notNull(),
  defaultDdo:  varchar("default_ddo", { length: 12 }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { financePfmsConfig };
