/**
 * items module — Drizzle schema in Postgres schema `inventory`.
 *
 * Item master: categories, units of measure (UoM) and the items themselves
 * (with reorder levels + valuation method + standard unit cost in paise).
 * Extended with HSN/GST tax classification, item substitutes, bin/rack
 * locations and custodian assignment (SVC-051..055).
 *
 * Every table carries tenant_id + a `version` column for optimistic locking.
 */
import { pgSchema, uuid, varchar, integer, bigint, char, boolean, date, timestamp, numeric } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("inventory");

export const categories = domainSchema.table("categories", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  name:      varchar("name", { length: 200 }).notNull(),
  code:      varchar("code", { length: 64 }).notNull(),
  parentId:  uuid("parent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export const uoms = domainSchema.table("uoms", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  name:      varchar("name", { length: 120 }).notNull(),
  symbol:    varchar("symbol", { length: 16 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export const items = domainSchema.table("items", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  name:            varchar("name", { length: 200 }).notNull(),
  sku:             varchar("sku", { length: 64 }),
  status:          varchar("status", { length: 24 }).notNull().default("active"),
  categoryId:      uuid("category_id"),
  uomId:           uuid("uom_id"),
  itemType:        varchar("item_type", { length: 16 }).notNull().default("consumable"),
  reorderLevel:    integer("reorder_level").notNull().default(0),
  reorderQty:      integer("reorder_qty").notNull().default(0),
  reorderMax:      integer("reorder_max").notNull().default(0),
  valuationMethod: varchar("valuation_method", { length: 8 }).notNull().default("WAVG"),
  unitCostMinor:   bigint("unit_cost_minor", { mode: "bigint" }).notNull().default(0n),
  currency:        char("currency", { length: 3 }).notNull().default("INR"),
  isActive:        boolean("is_active").notNull().default(true),
  // HSN/GST tax classification (SVC-051)
  hsnCode:         varchar("hsn_code", { length: 16 }),
  gstRate:         numeric("gst_rate", { precision: 5, scale: 2 }),
  taxClass:        varchar("tax_class", { length: 32 }),
  // Shelf life / expiry tracking (SVC-055)
  shelfLifeDays:   integer("shelf_life_days"),
  requiresBatchTracking: boolean("requires_batch_tracking").notNull().default(false),
  requiresSerialTracking: boolean("requires_serial_tracking").notNull().default(false),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

/** Item substitutes — links an item to its allowed replacement items. */
export const itemSubstitutes = domainSchema.table("item_substitutes", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  itemId:          uuid("item_id").notNull(),
  substituteId:    uuid("substitute_id").notNull(),
  priority:        integer("priority").notNull().default(1),
  conversionFactor: numeric("conversion_factor", { precision: 10, scale: 4 }).notNull().default("1.0"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
});

/** Bin/rack locations within a store — physical storage positions. */
export const bins = domainSchema.table("bins", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  storeId:   uuid("store_id").notNull(),
  code:      varchar("code", { length: 64 }).notNull(),
  aisle:     varchar("aisle", { length: 16 }),
  rack:      varchar("rack", { length: 16 }),
  shelf:     varchar("shelf", { length: 16 }),
  capacity:  integer("capacity"),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

/** Custodian assignment — tracks who is responsible for items in a store/bin. */
export const custodians = domainSchema.table("custodians", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  storeId:      uuid("store_id").notNull(),
  employeeRef:  uuid("employee_ref").notNull(),
  designation:  varchar("designation", { length: 120 }),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo:   date("effective_to"),
  status:       varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

/**
 * Stock reservations — items allocated against an indent/PO but not yet issued.
 * Reduces available-to-promise without reducing on-hand balance.
 */
export const reservations = domainSchema.table("reservations", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  itemId:      uuid("item_id").notNull(),
  storeId:     uuid("store_id").notNull(),
  qty:         integer("qty").notNull(),
  refType:     varchar("ref_type", { length: 32 }).notNull(),
  refId:       uuid("ref_id").notNull(),
  status:      varchar("status", { length: 24 }).notNull().default("active"),
  expiresAt:   timestamp("expires_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

/**
 * Goods returns — returned/rejected items from an issue, with QC gate.
 */
export const goodsReturns = domainSchema.table("goods_returns", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  originalIssueId: uuid("original_issue_id").notNull(),
  itemId:         uuid("item_id").notNull(),
  storeId:        uuid("store_id").notNull(),
  qty:            integer("qty").notNull(),
  reason:         varchar("reason", { length: 200 }).notNull(),
  qcStatus:       varchar("qc_status", { length: 24 }).notNull().default("pending"),
  qcInspectedBy:  uuid("qc_inspected_by"),
  qcInspectedAt:  timestamp("qc_inspected_at", { withTimezone: true }),
  qcNotes:        varchar("qc_notes", { length: 512 }),
  disposition:    varchar("disposition", { length: 24 }).notNull().default("pending"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type CategoryRow    = typeof categories.$inferSelect;
export type CategoryInsert = typeof categories.$inferInsert;
export type UomRow         = typeof uoms.$inferSelect;
export type UomInsert      = typeof uoms.$inferInsert;
export type ItemRow        = typeof items.$inferSelect;
export type ItemInsert     = typeof items.$inferInsert;
export type ItemSubstituteRow    = typeof itemSubstitutes.$inferSelect;
export type ItemSubstituteInsert = typeof itemSubstitutes.$inferInsert;
export type BinRow         = typeof bins.$inferSelect;
export type BinInsert      = typeof bins.$inferInsert;
export type CustodianRow   = typeof custodians.$inferSelect;
export type CustodianInsert = typeof custodians.$inferInsert;
export type ReservationRow  = typeof reservations.$inferSelect;
export type ReservationInsert = typeof reservations.$inferInsert;
export type GoodsReturnRow  = typeof goodsReturns.$inferSelect;
export type GoodsReturnInsert = typeof goodsReturns.$inferInsert;

/** Read projection returned to API consumers (money as string for JSON safety). */
export type ItemView = {
  id: string;
  tenantId: string;
  name: string;
  sku: string | null;
  status: string;
  categoryId: string | null;
  category: string | null;
  uomId: string | null;
  uom: string | null;
  itemType: string;
  reorderLevel: number;
  reorderQty: number;
  reorderMax: number;
  valuationMethod: string;
  unitCostMinor: string;
  currency: string;
  isActive: boolean;
  hsnCode: string | null;
  gstRate: string | null;
  taxClass: string | null;
  shelfLifeDays: number | null;
  requiresBatchTracking: boolean;
  requiresSerialTracking: boolean;
  version: number;
};

export const schema = {
  categories, uoms, items, itemSubstitutes, bins, custodians, reservations, goodsReturns,
};
