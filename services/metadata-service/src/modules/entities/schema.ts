import { pgSchema, uuid, varchar, text, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { numberFormats, numberSequences } from "../numbering/schema.js";

export const metadataSchema = pgSchema("metadata");

export const entityDefinitions = metadataSchema.table("entity_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  apiName: varchar("api_name", { length: 128 }).notNull(),
  label: varchar("label", { length: 256 }).notNull(),
  pluralLabel: varchar("plural_label", { length: 256 }).notNull(),
  description: text("description"),
  icon: varchar("icon", { length: 64 }).default("cube"),
  isActive: boolean("is_active").notNull().default(true),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: uuid("published_by"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export const fieldDefinitions = metadataSchema.table("field_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  entityDefId: uuid("entity_def_id").notNull(),
  apiName: varchar("api_name", { length: 128 }).notNull(),
  label: varchar("label", { length: 256 }).notNull(),
  fieldType: varchar("field_type", { length: 32 }).notNull(),
  isRequired: boolean("is_required").notNull().default(false),
  isUnique: boolean("is_unique").notNull().default(false),
  defaultValue: jsonb("default_value"),
  validationRule: jsonb("validation_rule"),
  picklistValues: jsonb("picklist_values"),
  lookupEntityId: uuid("lookup_entity_id"),
  formulaExpression: text("formula_expression"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export const layoutDefinitions = metadataSchema.table("layout_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  entityDefId: uuid("entity_def_id").notNull(),
  layoutType: varchar("layout_type", { length: 32 }).notNull().default("detail"),
  sections: jsonb("sections").notNull().default([]),
  isDefault: boolean("is_default").notNull().default(false),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export const customRecords = metadataSchema.table("custom_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  entityDefId: uuid("entity_def_id").notNull(),
  data: jsonb("data").notNull().default({}),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export const validationRules = metadataSchema.table("validation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  entityDefId: uuid("entity_def_id").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  expression: text("expression").notNull(),
  errorMessage: varchar("error_message", { length: 512 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export const formulaDefinitions = metadataSchema.table("formula_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  apiName: varchar("api_name", { length: 128 }).notNull(),
  label: varchar("label", { length: 256 }).notNull(),
  expression: text("expression").notNull(),
  returnType: varchar("return_type", { length: 16 }).notNull().default("number"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export const moduleCompositions = metadataSchema.table("module_compositions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  apiName: varchar("api_name", { length: 128 }).notNull(),
  label: varchar("label", { length: 256 }).notNull(),
  definition: jsonb("definition").notNull().default({}),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: uuid("published_by"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export const schema = {
  entityDefinitions,
  numberFormats,
  numberSequences,
  fieldDefinitions,
  layoutDefinitions,
  customRecords,
  validationRules,
  formulaDefinitions,
  moduleCompositions,
};
