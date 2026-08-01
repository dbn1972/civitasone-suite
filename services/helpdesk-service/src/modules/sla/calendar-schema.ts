/**
 * Business Calendars schema — helpdesk.business_calendars
 *
 * Defines work days, hours, and holidays for SLA deadline computation.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const helpdeskSchema = pgSchema("helpdesk");

export interface WorkDay {
  day: number; // 0=Sunday, 1=Monday ... 6=Saturday
  start: string; // "09:00"
  end: string; // "17:00"
}

export interface Holiday {
  date: string; // ISO date "2025-01-26"
  name: string;
}

export const businessCalendars = helpdeskSchema.table("business_calendars", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  timezone: varchar("timezone", { length: 64 }).notNull().default("Asia/Kolkata"),
  workDays: jsonb("work_days").$type<WorkDay[]>().notNull(),
  holidays: jsonb("holidays").$type<Holiday[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type BusinessCalendarRow = typeof businessCalendars.$inferSelect;
export type BusinessCalendarInsert = typeof businessCalendars.$inferInsert;

export const schema = { businessCalendars };
