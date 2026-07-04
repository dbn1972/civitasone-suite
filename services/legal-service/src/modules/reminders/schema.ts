import { pgSchema, uuid, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const remindersSchema = pgSchema("reminders");

export const legalReminders = remindersSchema.table("legal_reminders", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  caseId:    uuid("case_id").notNull(),
  remindAt:  timestamp("remind_at", { withTimezone: true }).notNull(),
  message:   text("message").notNull(),
  sent:      boolean("sent").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export type ReminderRow = typeof legalReminders.$inferSelect;
export type ReminderInsert = typeof legalReminders.$inferInsert;

export const schema = { legalReminders };
