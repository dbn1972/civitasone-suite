import { pgSchema, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const activities = crmSchema.table("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  actorName: varchar("actor_name", { length: 200 }).notNull(),
  text: text("text").notNull(),
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
  createdAt: string;
};

export const schema = { activities };
