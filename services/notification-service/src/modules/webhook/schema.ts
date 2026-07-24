import { pgSchema, uuid, varchar, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const webhookSchema = pgSchema("webhook");

export const webhookEndpoints = webhookSchema.table("endpoints", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  name:      varchar("name", { length: 128 }).notNull(),
  url:       text("url").notNull(),
  secret:    text("secret").notNull(),
  enabled:   boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;
export type WebhookEndpointInsert = typeof webhookEndpoints.$inferInsert;

export const webhookModuleSchema = { webhookEndpoints };
