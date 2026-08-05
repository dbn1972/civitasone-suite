import { pgSchema, uuid, varchar, integer, bigint, char, timestamp, boolean, date } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const subscriptions = crmSchema.table("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  productId: uuid("product_id").notNull(),
  type: varchar("type", { length: 16 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  startDate: date("start_date").notNull(),
  nextDueDate: date("next_due_date"),
  frequency: varchar("frequency", { length: 12 }).notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  autoRenew: boolean("auto_renew").notNull().default(true),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SubscriptionRow = typeof subscriptions.$inferSelect;

export const schema = { subscriptions };
