import { pgSchema, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

export const analyticsSchema = pgSchema("analytics");

export const openEvents = analyticsSchema.table("open_events", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  deliveryId: uuid("delivery_id").notNull(),
  openedAt:   timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clickEvents = analyticsSchema.table("click_events", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  deliveryId: uuid("delivery_id").notNull(),
  linkUrl:    text("link_url").notNull(),
  clickedAt:  timestamp("clicked_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deliveryMetrics = analyticsSchema.table("delivery_metrics", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  templateId:  uuid("template_id"),
  campaignId:  uuid("campaign_id"),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd:   timestamp("period_end", { withTimezone: true }).notNull(),
  sentCount:   integer("sent_count").notNull().default(0),
  openCount:   integer("open_count").notNull().default(0),
  clickCount:  integer("click_count").notNull().default(0),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OpenEventRow = typeof openEvents.$inferSelect;
export type OpenEventInsert = typeof openEvents.$inferInsert;
export type ClickEventRow = typeof clickEvents.$inferSelect;
export type ClickEventInsert = typeof clickEvents.$inferInsert;
export type DeliveryMetricsRow = typeof deliveryMetrics.$inferSelect;
export type DeliveryMetricsInsert = typeof deliveryMetrics.$inferInsert;

export const analyticsModuleSchema = { openEvents, clickEvents, deliveryMetrics };
