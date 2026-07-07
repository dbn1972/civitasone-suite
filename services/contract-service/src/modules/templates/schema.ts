import { pgSchema, uuid, text, integer, varchar, timestamp } from "drizzle-orm/pg-core";

export const templatesSchema = pgSchema("templates");

export const contractTemplates = templatesSchema.table("contract_templates", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  name:        varchar("name", { length: 500 }).notNull(),
  description: text("description").notNull().default(""),
  status:      varchar("status", { length: 24 }).notNull().default("draft"),
  version:     integer("version").notNull().default(1),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
});

export const templateClauses = templatesSchema.table("template_clauses", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  templateId:        uuid("template_id").notNull(),
  clauseId:          uuid("clause_id").notNull(),
  rank:              integer("rank").notNull(),
  conditionType:     varchar("condition_type", { length: 24 }).notNull().default("always"),
  conditionField:    varchar("condition_field", { length: 200 }),
  conditionOperator: varchar("condition_operator", { length: 24 }),
  conditionValue:    varchar("condition_value", { length: 500 }),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
});

export type TemplateRow = typeof contractTemplates.$inferSelect;
export type TemplateInsert = typeof contractTemplates.$inferInsert;
export type TemplateClauseRow = typeof templateClauses.$inferSelect;
export type TemplateClauseInsert = typeof templateClauses.$inferInsert;

export const schema = { contractTemplates, templateClauses };
