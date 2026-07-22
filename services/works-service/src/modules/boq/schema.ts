import { pgSchema, uuid, varchar, integer, bigint, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

const works = pgSchema("works");

export const boqItems = works.table("boq_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  srItemId: uuid("sr_item_id"),
  itemType: varchar("item_type", { length: 64 }),
  itemDescription: varchar("item_description", { length: 1024 }).notNull(),
  itemCode: varchar("item_code", { length: 64 }),
  unit: varchar("unit", { length: 64 }).notNull(),
  rate: bigint("rate", { mode: "bigint" }).notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  numberVal: numeric("number_val", { precision: 12, scale: 4 }),
  lengthVal: numeric("length_val", { precision: 12, scale: 4 }),
  breadthVal: numeric("breadth_val", { precision: 12, scale: 4 }),
  depthVal: numeric("depth_val", { precision: 12, scale: 4 }),
  scopeId: uuid("scope_id"),
  remarks: varchar("remarks", { length: 2048 }),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scheduleAItems = works.table("schedule_a_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  itemDescription: varchar("item_description", { length: 1024 }).notNull(),
  unit: varchar("unit", { length: 64 }).notNull(),
  rate: bigint("rate", { mode: "bigint" }).notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  remarks: varchar("remarks", { length: 2048 }),
  version: integer("version").notNull().default(1),
});

export const recapitulation = works.table("recapitulation", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  workAmount: bigint("work_amount", { mode: "bigint" }).notNull(),
  contingencyPercent: numeric("contingency_percent", { precision: 5, scale: 2 }).notNull(),
  turnoverTaxPercent: numeric("turnover_tax_percent", { precision: 5, scale: 2 }).notNull(),
  workChargePercent: numeric("work_charge_percent", { precision: 5, scale: 2 }).notNull(),
  qualityControlPercent: numeric("quality_control_percent", { precision: 5, scale: 2 }).notNull(),
  centagePercent: numeric("centage_percent", { precision: 5, scale: 2 }).notNull(),
  otherCharges: bigint("other_charges", { mode: "bigint" }).notNull().default(0n),
  grandTotal: bigint("grand_total", { mode: "bigint" }).notNull(),
  version: integer("version").notNull().default(1),
});

export const materialCoefficients = works.table("material_coefficients", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  boqItemId: uuid("boq_item_id").notNull(),
  materialName: varchar("material_name", { length: 256 }).notNull(),
  coefficient: numeric("coefficient", { precision: 12, scale: 6 }).notNull(),
  finalized: boolean("finalized").notNull().default(false),
  finalizedBy: uuid("finalized_by"),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
});

export const schema = { boqItems, scheduleAItems, recapitulation, materialCoefficients };
