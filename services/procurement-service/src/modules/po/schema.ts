import { pgSchema, uuid, text, integer, bigint, char, varchar, timestamp, date } from "drizzle-orm/pg-core";

export const poSchema = pgSchema("po");

export const procurementPos = poSchema.table("procurement_pos", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  poNo:            text("po_no").notNull(),
  vendorId:        uuid("vendor_id").notNull(),
  indentRef:       text("indent_ref").notNull(),
  sanctionRef:     text("sanction_ref"),
  rateContractRef: text("rate_contract_ref"),
  gemOrderNo:      text("gem_order_no"),
  totalMinor:      bigint("total_minor", { mode: "bigint" }).notNull().default(0n),
  currency:        char("currency", { length: 3 }).notNull().default("INR"),
  status:          varchar("status", { length: 24 }).notNull().default("draft"),
  deliveryDate:    date("delivery_date"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const procurementPoItems = poSchema.table("procurement_po_items", {
  id:             uuid("id").primaryKey().defaultRandom(),
  poId:           uuid("po_id").notNull(),
  tenantId:       uuid("tenant_id").notNull(),
  itemCode:       text("item_code").notNull(),
  description:    text("description").notNull(),
  quantity:       integer("quantity").notNull().default(1),
  unit:           varchar("unit", { length: 32 }).notNull().default("nos"),
  unitPriceMinor: bigint("unit_price_minor", { mode: "bigint" }).notNull().default(0n),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type PoRow    = typeof procurementPos.$inferSelect;
export type PoInsert = typeof procurementPos.$inferInsert;

export const schema = { procurementPos, procurementPoItems };
