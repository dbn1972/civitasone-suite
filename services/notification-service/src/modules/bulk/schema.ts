import { pgSchema, uuid, varchar, integer, timestamp, text, char, bigint, boolean } from "drizzle-orm/pg-core";

export const bulkSchema = pgSchema("bulk");

export const notificationCampaigns = bulkSchema.table("campaigns", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  templateId:  uuid("template_id").notNull(),
  name:        varchar("name", { length: 128 }).notNull(),
  status:      varchar("status", { length: 24 }).notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  // MK-001/MK-004 marketing fields (migration 0035). Money is bigint PAISE.
  objective:         text("objective"),
  audienceSegmentId: uuid("audience_segment_id"),
  budgetMinor:       bigint("budget_minor", { mode: "bigint" }).notNull().default(0n),
  currency:          char("currency", { length: 3 }).notNull().default("INR"),
  actualCostMinor:   bigint("actual_cost_minor", { mode: "bigint" }).notNull().default(0n),
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

// MK-004: per-subject campaign responses + attributed revenue (paise).
export const notificationCampaignResponses = bulkSchema.table("campaign_responses", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  campaignId:   uuid("campaign_id").notNull(),
  subjectType:  varchar("subject_type", { length: 16 }).notNull(),
  subjectId:    uuid("subject_id").notNull(),
  responded:    boolean("responded").notNull().default(true),
  converted:    boolean("converted").notNull().default(false),
  revenueMinor: bigint("revenue_minor", { mode: "bigint" }).notNull().default(0n),
  respondedAt:  timestamp("responded_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type CampaignRow    = typeof notificationCampaigns.$inferSelect;
export type CampaignInsert = typeof notificationCampaigns.$inferInsert;
export type CampaignRecipientRow = typeof notificationCampaignRecipients.$inferSelect;
export type CampaignResponseRow    = typeof notificationCampaignResponses.$inferSelect;
export type CampaignResponseInsert = typeof notificationCampaignResponses.$inferInsert;

export const bulkModuleSchema = {
  notificationCampaigns,
  notificationCampaignRecipients,
  notificationCampaignResponses,
};
