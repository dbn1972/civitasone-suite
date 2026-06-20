import { pgSchema, uuid, varchar, boolean, integer, timestamp, text } from "drizzle-orm/pg-core";

export const channelsSchema = pgSchema("channels");

export const notificationChannels = channelsSchema.table("channels", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  type:      varchar("type", { length: 32 }).notNull(),
  name:      varchar("name", { length: 128 }).notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  enabled:   boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export const notificationChannelConfigs = channelsSchema.table("channel_configs", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  channelId: uuid("channel_id").notNull(),
  configKey: varchar("config_key", { length: 128 }).notNull(),
  configVal: text("config_val").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export type ChannelRow    = typeof notificationChannels.$inferSelect;
export type ChannelInsert = typeof notificationChannels.$inferInsert;
export type ChannelConfigRow = typeof notificationChannelConfigs.$inferSelect;

export const channelsModuleSchema = { notificationChannels, notificationChannelConfigs };
