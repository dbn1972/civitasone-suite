import { pgSchema, uuid, varchar, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const contextAttachRules = crmSchema.table("context_attach_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  matchField: varchar("match_field", { length: 64 }).notNull(),
  matchTarget: varchar("match_target", { length: 16 }).notNull(),
  targetField: varchar("target_field", { length: 64 }).notNull(),
  action: varchar("action", { length: 16 }).notNull(),
  active: boolean("active").notNull().default(true),
  priority: integer("priority").notNull().default(0),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export const contextAttachments = crmSchema.table("context_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  ruleId: uuid("rule_id").notNull(),
  eventRef: varchar("event_ref", { length: 128 }).notNull(),
  targetType: varchar("target_type", { length: 16 }).notNull(),
  targetId: uuid("target_id").notNull(),
  attachedAt: timestamp("attached_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ContextAttachRuleRow = typeof contextAttachRules.$inferSelect;
export type ContextAttachRuleInsert = typeof contextAttachRules.$inferInsert;
export type ContextAttachmentRow = typeof contextAttachments.$inferSelect;
export type ContextAttachmentInsert = typeof contextAttachments.$inferInsert;

export const schema = { contextAttachRules, contextAttachments };
