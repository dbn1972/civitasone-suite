import { pgSchema, uuid, varchar, date, integer, timestamp } from "drizzle-orm/pg-core";

const leaveSchema = pgSchema("leave");

export const hrmsHolidays = leaveSchema.table("hrms_holidays", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  name:         varchar("name", { length: 256 }).notNull(),
  date:         date("date").notNull(),
  type:         varchar("type", { length: 32 }).notNull().default("gazetted"),
  applicableTo: varchar("applicable_to", { length: 1024 }).default("all"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type HolidayRow = typeof hrmsHolidays.$inferSelect;
