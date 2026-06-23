import { pgSchema, uuid, varchar, text, timestamp, date } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const activities = crmSchema.table("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  actorName: varchar("actor_name", { length: 200 }).notNull(),
  text: text("text").notNull(),
  contactId: uuid("contact_id"),
  dealId: uuid("deal_id"),
  type: varchar("type", { length: 16 }).notNull().default("note"),
  subject: varchar("subject", { length: 200 }),
  status: varchar("status", { length: 24 }).notNull().default("open"),
  dueDate: date("due_date"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type ActivityRow = typeof activities.$inferSelect;
export type ActivityInsert = typeof activities.$inferInsert;

export type ActivityView = {
  id: string;
  tenantId: string;
  actorName: string;
  text: string;
  contactId: string | null;
  dealId: string | null;
  type: string;
  subject: string | null;
  status: string;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
};

export const schema = { activities };
