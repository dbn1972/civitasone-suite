import { pgSchema, uuid, varchar, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const templatesSchema = pgSchema("templates");

export const notificationTemplates = templatesSchema.table("templates", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  channel:   varchar("channel", { length: 32 }).notNull(),
  name:      varchar("name", { length: 128 }).notNull(),
  subject:   varchar("subject", { length: 256 }),
  body:      text("body").notNull(),
  status:    varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
  supersededBy: uuid("superseded_by"),
});

export const notificationPrefs = templatesSchema.table("prefs", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  userId:    uuid("user_id").notNull(),
  eventType: varchar("event_type", { length: 128 }).notNull(),
  inApp:     boolean("in_app").notNull().default(true),
  email:     boolean("email").notNull().default(true),
  push:      boolean("push").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export type TemplateRow    = typeof notificationTemplates.$inferSelect;
export type TemplateInsert = typeof notificationTemplates.$inferInsert;
export type PrefRow        = typeof notificationPrefs.$inferSelect;
export type PrefInsert     = typeof notificationPrefs.$inferInsert;

export const templatesModuleSchema = { notificationTemplates, notificationPrefs };
