/**
 * Org-model Drizzle schema (District Governance Platform, Wave-A EPIC-1).
 *
 * Mirrors migration 0012_org_model.sql. These tables extend the flat
 * Tenant -> Department -> User model into the office/position/posting/jurisdiction
 * structure a district needs. Downstream consumers:
 *   - identity-service enriches the JWT with the caller's active posting
 *     (office_id / position_id) — see EPIC-2.
 *   - policy-service ABAC fences reads by jurisdiction — see EPIC-2.
 */
import { pgSchema, uuid, varchar, integer, bigint, boolean, date, timestamp } from "drizzle-orm/pg-core";

export const hierarchySchema = pgSchema("hierarchy");

/** Canonical level taxonomy (reference data — not tenant-scoped). */
export const unitTypes = hierarchySchema.table("unit_types", {
  code: varchar("code", { length: 32 }).primaryKey(),
  label: varchar("label", { length: 120 }).notNull(),
  domain: varchar("domain", { length: 16 }).notNull().default("civil"),
  rank: integer("rank").notNull().default(100),
});

/** A distinct office located at an administrative unit. */
export const offices = hierarchySchema.table("offices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 240 }).notNull(),
  officeType: varchar("office_type", { length: 48 }).notNull(),
  domain: varchar("domain", { length: 16 }).notNull().default("civil"),
  adminUnitId: uuid("admin_unit_id").notNull(),
  parentOfficeId: uuid("parent_office_id"),
  lgdCode: varchar("lgd_code", { length: 32 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

/** Sanctioned post within an office. */
export const positions = hierarchySchema.table("positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  officeId: uuid("office_id").notNull(),
  designation: varchar("designation", { length: 160 }).notNull(),
  grade: varchar("grade", { length: 48 }),
  financialPowersMinor: bigint("financial_powers_minor", { mode: "bigint" }).notNull().default(0n),
  magisterial: boolean("magisterial").notNull().default(false),
  isSanctioned: boolean("is_sanctioned").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

/** Effective-dated assignment of an employee to a position at an office. */
export const postings = hierarchySchema.table("postings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  positionId: uuid("position_id").notNull(),
  officeId: uuid("office_id").notNull(),
  chargeType: varchar("charge_type", { length: 24 }).notNull().default("substantive"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  isActive: boolean("is_active").notNull().default(true),
  orderRef: varchar("order_ref", { length: 120 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type OfficeRow = typeof offices.$inferSelect;
export type OfficeInsert = typeof offices.$inferInsert;
export type PositionRow = typeof positions.$inferSelect;
export type PositionInsert = typeof positions.$inferInsert;
export type PostingRow = typeof postings.$inferSelect;
export type PostingInsert = typeof postings.$inferInsert;
export type UnitTypeRow = typeof unitTypes.$inferSelect;

export const schema = { unitTypes, offices, positions, postings };
