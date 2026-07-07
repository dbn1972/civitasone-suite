import { pgSchema, uuid, text, integer, varchar, timestamp, date } from "drizzle-orm/pg-core";

export const obligationsSchema = pgSchema("obligations");

export const contractObligations = obligationsSchema.table("contract_obligations", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  contractId:  uuid("contract_id").notNull(),
  title:       text("title").notNull(),
  description: text("description").notNull().default(""),
  dueDate:     date("due_date").notNull(),
  status:      varchar("status", { length: 24 }).notNull().default("pending"),
  ownerId:     uuid("owner_id").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const obligationReminders = obligationsSchema.table("obligation_reminders", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  obligationId:  uuid("obligation_id").notNull(),
  reminderDate:  date("reminder_date").notNull(),
  daysBefore:    integer("days_before").notNull(),
  sent:          varchar("sent", { length: 10 }).notNull().default("pending"), // "pending" | "sent"
  sentAt:        timestamp("sent_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ObligationRow = typeof contractObligations.$inferSelect;
export type ObligationInsert = typeof contractObligations.$inferInsert;
export type ObligationReminderRow = typeof obligationReminders.$inferSelect;
export type ObligationReminderInsert = typeof obligationReminders.$inferInsert;

export const schema = { contractObligations, obligationReminders };
