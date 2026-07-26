import { pgSchema, uuid, varchar, jsonb, timestamp } from "drizzle-orm/pg-core";
import type { ChecklistItem } from "./domain.js";

export const domainSchema = pgSchema("workflow");

/** CAP-036 — reusable checklist template. */
export const checklistTemplates = domainSchema.table("checklist_templates", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  code:      varchar("code", { length: 64 }).notNull(),
  name:      varchar("name", { length: 200 }).notNull(),
  items:     jsonb("items").$type<Array<{ key: string; label: string; required?: boolean }>>().notNull().default([]),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** CAP-036 — a checklist instance bound to an entity, with per-item state. */
export const checklistInstances = domainSchema.table("checklist_instances", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  templateId: uuid("template_id"),
  entityType: varchar("entity_type", { length: 48 }).notNull(),
  entityId:   uuid("entity_id").notNull(),
  items:      jsonb("items").$type<ChecklistItem[]>().notNull().default([]),
  createdBy:  uuid("created_by").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ChecklistTemplateRow = typeof checklistTemplates.$inferSelect;
export type ChecklistInstanceRow = typeof checklistInstances.$inferSelect;

export const schema = { checklistTemplates, checklistInstances };
