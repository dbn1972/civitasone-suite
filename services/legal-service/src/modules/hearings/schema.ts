import { pgSchema, uuid, text, integer, varchar, timestamp, date } from "drizzle-orm/pg-core";

export const hearingsSchema = pgSchema("hearings");

export const legalHearings = hearingsSchema.table("legal_hearings", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  caseId:       uuid("case_id").notNull(),
  hearingDate:  date("hearing_date").notNull(),
  court:        text("court").notNull(),
  purpose:      text("purpose"),
  status:       varchar("status", { length: 24 }).notNull().default("scheduled"),
  nextDate:     date("next_date"),
  previousDate: date("previous_date"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export const legalOrders = hearingsSchema.table("legal_orders", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  caseId:    uuid("case_id").notNull(),
  orderType: varchar("order_type", { length: 32 }).notNull(),
  direction: text("direction"),
  deptRef:   text("dept_ref"),
  summary:   text("summary").notNull(),
  orderDate: date("order_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export type HearingRow = typeof legalHearings.$inferSelect;
export const schema = { legalHearings, legalOrders };
