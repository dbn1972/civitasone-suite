import { pgSchema, uuid, varchar, integer, timestamp, text } from "drizzle-orm/pg-core";

export const periodCloseSchema = pgSchema("gl");

export const financePeriodClose = periodCloseSchema.table("finance_period_close", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  fiscalYear: varchar("fiscal_year", { length: 9 }).notNull(),
  period:     varchar("period", { length: 7 }).notNull(),
  status:     varchar("status", { length: 12 }).notNull().default("open"),
  closedBy:   uuid("closed_by"),
  closedAt:   timestamp("closed_at", { withTimezone: true }),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // BUG FIX (accounting-critical #1): this table was actually created by
  // 0005_world_class.sql, not 0006_period_close.sql (0006's CREATE TABLE IF
  // NOT EXISTS silently no-op'd against the table 0005 already created — see
  // migrations/0076_period_close_unique_constraint.sql). 0005's version carries
  // a `created_by UUID NOT NULL` column with no default that this schema (built
  // against 0006's never-applied shape) omitted entirely, so every insert
  // attempt — once the ON CONFLICT target itself started resolving — failed
  // with "null value in column \"created_by\" violates not-null constraint".
  // Modelled here to match the live column, same pattern as
  // financePeriodReopenLog.createdBy below.
  createdBy:  uuid("created_by").notNull(),
});


export const financePeriodReopenLog = periodCloseSchema.table("finance_period_reopen_log", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  period:     varchar("period", { length: 7 }).notNull(),
  fromStatus: varchar("from_status", { length: 12 }).notNull(),
  toStatus:   varchar("to_status", { length: 12 }).notNull(),
  reason:     text("reason"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
});

export const schema = { financePeriodClose, financePeriodReopenLog };
