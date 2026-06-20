import { pgSchema, uuid, varchar, text, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const alertsSchema = pgSchema("alerts");

export const notificationAlertRules = alertsSchema.table("alert_rules", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  name:         varchar("name", { length: 128 }).notNull(),
  triggerEvent: text("trigger_event").notNull(),
  conditions:   jsonb("conditions").$type<Record<string, unknown>>().notNull().default({}),
  channel:      text("channel").notNull(),
  recipients:   jsonb("recipients").$type<string[]>().notNull().default([]),
  enabled:      boolean("enabled").notNull().default(true),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export const notificationAlertEvents = alertsSchema.table("alert_events", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  ruleId:    uuid("rule_id").notNull(),
  payload:   jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status:    varchar("status", { length: 24 }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export type AlertRuleRow    = typeof notificationAlertRules.$inferSelect;
export type AlertRuleInsert = typeof notificationAlertRules.$inferInsert;

export const alertsModuleSchema = { notificationAlertRules, notificationAlertEvents };
