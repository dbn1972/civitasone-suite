/**
 * inspection-service: universe module Drizzle schema.
 *
 * Defines the `universe` PG schema with reference/master data tables:
 * - regulated_entities — entities subject to inspection
 * - inspection_types — configurable inspection type catalogue
 * - provisions — regulatory provisions/act sections for findings
 * - vocabularies — lookup values for dropdowns and categorisation
 *
 * _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6_
 */
import {
  pgSchema,
  uuid,
  text,
  integer,
  varchar,
  timestamp,
  numeric,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** The `universe` PG schema — master/reference data for the inspection service. */
export const universeSchema = pgSchema("universe");

// ── universe.regulated_entities ───────────────────────────────────────────
export const regulatedEntities = universeSchema.table("regulated_entities", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  registrationNo: text("registration_no").notNull(),
  entityType:     varchar("entity_type", { length: 48 }).notNull(),
  name:           text("name").notNull(),
  jurisdiction:   text("jurisdiction").notNull(),
  addressLine1:   text("address_line1").notNull(),
  addressLine2:   text("address_line2"),
  city:           text("city").notNull(),
  state:          text("state").notNull(),
  pincode:        varchar("pincode", { length: 10 }).notNull(),
  latitude:       numeric("latitude", { precision: 10, scale: 7 }),
  longitude:      numeric("longitude", { precision: 10, scale: 7 }),
  riskCategory:   varchar("risk_category", { length: 24 }).notNull().default("medium"),
  metadata:       jsonb("metadata"),
  deletedAt:      timestamp("deleted_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
}, (table) => ({
  uniqueRegistrationPerTenant: uniqueIndex("idx_regulated_entities_tenant_registration")
    .on(table.tenantId, table.registrationNo),
}));

// ── universe.inspection_types ─────────────────────────────────────────────
export const inspectionTypes = universeSchema.table("inspection_types", {
  id:                    uuid("id").primaryKey().defaultRandom(),
  tenantId:              uuid("tenant_id").notNull(),
  name:                  text("name").notNull(),
  code:                  varchar("code", { length: 32 }).notNull(),
  applicableEntityTypes: jsonb("applicable_entity_types").notNull(), // string[]
  requiredCompetencies:  jsonb("required_competencies").notNull(),   // string[]
  defaultTemplateIds:    jsonb("default_template_ids").notNull(),    // uuid[]
  regulatoryBasis:       jsonb("regulatory_basis"),                  // provision references
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:             uuid("created_by").notNull(),
  updatedBy:             uuid("updated_by").notNull(),
  version:               integer("version").notNull().default(1),
}, (table) => ({
  uniqueCodePerTenant: uniqueIndex("idx_inspection_types_tenant_code")
    .on(table.tenantId, table.code),
}));

// ── universe.provisions ───────────────────────────────────────────────────
export const provisions = universeSchema.table("provisions", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  actReference:   text("act_reference").notNull(),
  sectionNumber:  text("section_number").notNull(),
  description:    text("description").notNull(),
  penaltyClause:  text("penalty_clause"),
  severityClass:  varchar("severity_class", { length: 16 }).notNull(), // critical|major|minor|observation
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

// ── universe.vocabularies ─────────────────────────────────────────────────
export const vocabularies = universeSchema.table("vocabularies", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  category:  varchar("category", { length: 48 }).notNull(), // violation_category|severity_level|disposition_code|action_type
  code:      varchar("code", { length: 32 }).notNull(),
  label:     text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive:  integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
}, (table) => ({
  uniqueCategoryCodePerTenant: uniqueIndex("idx_vocabularies_tenant_category_code")
    .on(table.tenantId, table.category, table.code),
}));

// ── Inferred types ────────────────────────────────────────────────────────
export type RegulatedEntityRow = typeof regulatedEntities.$inferSelect;
export type RegulatedEntityInsert = typeof regulatedEntities.$inferInsert;
export type InspectionTypeRow = typeof inspectionTypes.$inferSelect;
export type InspectionTypeInsert = typeof inspectionTypes.$inferInsert;
export type ProvisionRow = typeof provisions.$inferSelect;
export type ProvisionInsert = typeof provisions.$inferInsert;
export type VocabularyRow = typeof vocabularies.$inferSelect;
export type VocabularyInsert = typeof vocabularies.$inferInsert;

export const schema = { regulatedEntities, inspectionTypes, provisions, vocabularies };
