import { pgSchema, uuid, varchar, text, integer, timestamp } from "drizzle-orm/pg-core";

export const deliveriesSchema = pgSchema("deliveries");

export const notificationDeliveries = deliveriesSchema.table("deliveries", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  templateId: uuid("template_id").notNull(),
  recipient:  varchar("recipient", { length: 254 }).notNull(),
  channel:    varchar("channel", { length: 32 }).notNull(),
  status:       varchar("status", { length: 24 }).notNull().default("queued"),
  sentAt:       timestamp("sent_at", { withTimezone: true }),
  error:        text("error"),
  retryCount:   integer("retry_count").notNull().default(0),
  nextRetryAt:  timestamp("next_retry_at", { withTimezone: true }),
  errorDetail:  text("error_detail"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export type DeliveryRow    = typeof notificationDeliveries.$inferSelect;
export type DeliveryInsert = typeof notificationDeliveries.$inferInsert;

export const deliveriesModuleSchema = { notificationDeliveries };
