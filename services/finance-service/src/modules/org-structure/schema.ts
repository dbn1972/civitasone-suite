/**
 * ERP Organisational Structure (SAP Company Code / Oracle Legal Entity pattern).
 * These entities sit BETWEEN tenant (group) and department (admin unit).
 *
 * Hierarchy: Tenant → Legal Entity → Operating Unit → Cost Center / Profit Center
 */
import {
  pgSchema, uuid, text, char, integer, boolean, date, timestamp,
} from "drizzle-orm/pg-core";

export const orgSchema = pgSchema("org");

// ═══════════════════════════════════════════════════════════════════════════
// LEGAL ENTITY — independent accounting unit (own CoA, balance sheet, tax regs)
// ═══════════════════════════════════════════════════════════════════════════
export const legalEntities = orgSchema.table("legal_entities", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  code:            text("code").notNull(),
  name:            text("name").notNull(),
  entityType:      text("entity_type").notNull().default("company"),
  parentEntityId:  uuid("parent_entity_id"),
  // Tax registrations
  gstin:           text("gstin"),
  pan:             text("pan"),
  tan:             text("tan"),
  cin:             text("cin"),
  // Financial config
  currency:        char("currency", { length: 3 }).notNull().default("INR"),
  fiscalYearStart: text("fiscal_year_start").notNull().default("04-01"),
  coaId:           uuid("coa_id"),
  // Government (DDO/PAO)
  ddoCode:         text("ddo_code"),
  paoCode:         text("pao_code"),
  treasuryCode:    text("treasury_code"),
  // Location
  locationId:      uuid("location_id"),
  registeredAddress: text("registered_address"),
  // Status
  isActive:        boolean("is_active").notNull().default(true),
  effectiveFrom:   date("effective_from").notNull().default("2024-04-01"),
  effectiveTo:     date("effective_to"),
  // Audit
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

// ═══════════════════════════════════════════════════════════════════════════
// OPERATING UNIT — branch/plant that transacts under a legal entity
// ═══════════════════════════════════════════════════════════════════════════
export const operatingUnits = orgSchema.table("operating_units", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  legalEntityId:  uuid("legal_entity_id").notNull(),
  code:           text("code").notNull(),
  name:           text("name").notNull(),
  unitType:       text("unit_type").notNull().default("branch"),
  locationId:     uuid("location_id"),
  isActive:       boolean("is_active").notNull().default(true),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

// ═══════════════════════════════════════════════════════════════════════════
// COST CENTER — budget allocation / control point (hierarchical)
// ═══════════════════════════════════════════════════════════════════════════
export const costCenters = orgSchema.table("cost_centers", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  legalEntityId:  uuid("legal_entity_id").notNull(),
  code:           text("code").notNull(),
  name:           text("name").notNull(),
  parentId:       uuid("parent_id"),
  departmentId:   uuid("department_id"),
  managerId:      uuid("manager_id"),
  isActive:       boolean("is_active").notNull().default(true),
  effectiveFrom:  date("effective_from").notNull().default("2024-04-01"),
  effectiveTo:    date("effective_to"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

// ═══════════════════════════════════════════════════════════════════════════
// PROFIT CENTER — P&L responsibility (PSU / private)
// ═══════════════════════════════════════════════════════════════════════════
export const profitCenters = orgSchema.table("profit_centers", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  legalEntityId:  uuid("legal_entity_id").notNull(),
  code:           text("code").notNull(),
  name:           text("name").notNull(),
  parentId:       uuid("parent_id"),
  segment:        text("segment"),
  managerId:      uuid("manager_id"),
  isActive:       boolean("is_active").notNull().default(true),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type LegalEntityRow    = typeof legalEntities.$inferSelect;
export type LegalEntityInsert = typeof legalEntities.$inferInsert;
export type OperatingUnitRow    = typeof operatingUnits.$inferSelect;
export type OperatingUnitInsert = typeof operatingUnits.$inferInsert;
export type CostCenterRow    = typeof costCenters.$inferSelect;
export type CostCenterInsert = typeof costCenters.$inferInsert;
export type ProfitCenterRow    = typeof profitCenters.$inferSelect;
export type ProfitCenterInsert = typeof profitCenters.$inferInsert;

export const schema = { legalEntities, operatingUnits, costCenters, profitCenters };
