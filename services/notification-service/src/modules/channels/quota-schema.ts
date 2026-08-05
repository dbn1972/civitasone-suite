import { pgSchema, uuid, varchar, bigint, integer, date, timestamp } from "drizzle-orm/pg-core";

// Re-use the existing 'channels' schema
const channelsSchema = pgSchema("channels");

export const channelQuotas = channelsSchema.table("channel_quotas", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  channel:      varchar("channel", { length: 16 }).notNull(),
  monthlyLimit: bigint("monthly_limit", { mode: "bigint" }).notNull(),
  used:         bigint("used", { mode: "bigint" }).notNull().default(BigInt(0)),
  periodStart:  date("period_start").notNull(),
  periodEnd:    date("period_end").notNull(),
  status:       varchar("status", { length: 16 }).notNull().default("active"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type ChannelQuotaRow = typeof channelQuotas.$inferSelect;
export type ChannelQuotaInsert = typeof channelQuotas.$inferInsert;

export const quotaModuleSchema = { channelQuotas };
