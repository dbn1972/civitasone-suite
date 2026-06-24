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
