import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const bulkSchema = pgSchema("bulk");

export const notificationCampaigns = bulkSchema.table("campaigns", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  templateId:  uuid("template_id").notNull(),
  name:        varchar("name", { length: 128 }).notNull(),
  status:      varchar("status", { length: 24 }).notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const notificationCampaignRecipients = bulkSchema.table("campaign_recipients", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  campaignId:  uuid("campaign_id").notNull(),
  recipientId: varchar("recipient_id", { length: 254 }).notNull(),
  status:      varchar("status", { length: 24 }).notNull().default("pending"),
  deliveryId:  uuid("delivery_id"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type CampaignRow    = typeof notificationCampaigns.$inferSelect;
export type CampaignInsert = typeof notificationCampaigns.$inferInsert;
export type CampaignRecipientRow = typeof notificationCampaignRecipients.$inferSelect;

export const bulkModuleSchema = { notificationCampaigns, notificationCampaignRecipients };
