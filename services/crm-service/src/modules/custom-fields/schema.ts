/**
 * custom-fields module — Drizzle schema.
 * Tenant-scoped custom field definitions for CRM entity types (leads, contacts, deals).
 * Maximum 50 custom fields per entity type per tenant (enforced at route level).
 *
 * Validates: Requirements 8.8
 */
import { pgSchema, uuid, varchar, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const customFields = crmSchema.table("custom_fields", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  entityType: varchar("entity_type", { length: 24 }).notNull(), // leads | contacts | deals
  fieldName: varchar("field_name", { length: 64 }).notNull(),
  fieldType: varchar("field_type", { length: 24 }).notNull(), // text | number | date | boolean | select | multi_select
  validationSchema: jsonb("validation_schema"), // optional JSON schema for validation
  ordinal: integer("ordinal").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type CustomFieldRow = typeof customFields.$inferSelect;
export type CustomFieldInsert = typeof customFields.$inferInsert;

export type CustomFieldView = {
  id: string;
  tenantId: string;
  entityType: string;
  fieldName: string;
  fieldType: string;
  validationSchema: unknown;
  ordinal: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export const schema = { customFields };
