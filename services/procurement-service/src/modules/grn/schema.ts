import { pgSchema, uuid, text, integer, boolean, varchar, timestamp, date } from "drizzle-orm/pg-core";

export const grnSchema = pgSchema("grn");

export const procurementGrns = grnSchema.table("procurement_grns", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  grnNo:         text("grn_no").notNull(),
  poRef:         text("po_ref").notNull(),
  vendorId:      uuid("vendor_id").notNull(),
  receivedDate:  date("received_date").notNull().defaultNow(),
  threeWayMatch: boolean("three_way_match").notNull().default(false),
  status:        varchar("status", { length: 24 }).notNull().default("draft"),
  notes:         text("notes"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const procurementGrnItems = grnSchema.table("procurement_grn_items", {
  id:          uuid("id").primaryKey().defaultRandom(),
  grnId:       uuid("grn_id").notNull(),
  tenantId:    uuid("tenant_id").notNull(),
  poItemRef:   text("po_item_ref").notNull(),
  itemCode:    text("item_code").notNull(),
  orderedQty:  integer("ordered_qty").notNull().default(0),
  receivedQty: integer("received_qty").notNull().default(0),
  acceptedQty: integer("accepted_qty").notNull().default(0),
  unit:        varchar("unit", { length: 32 }).notNull().default("nos"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const procurementInspections = grnSchema.table("procurement_inspections", {
  id:             uuid("id").primaryKey().defaultRandom(),
  grnId:          uuid("grn_id").notNull(),
  tenantId:       uuid("tenant_id").notNull(),
  inspectorId:    uuid("inspector_id").notNull(),
  inspectionDate: date("inspection_date").notNull().defaultNow(),
  result:         varchar("result", { length: 16 }).notNull().default("pending"),
  remarks:        text("remarks"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type GrnRow    = typeof procurementGrns.$inferSelect;
export type GrnInsert = typeof procurementGrns.$inferInsert;
export type GrnItemRow    = typeof procurementGrnItems.$inferSelect;
export type GrnItemInsert = typeof procurementGrnItems.$inferInsert;

export const schema = { procurementGrns, procurementGrnItems, procurementInspections };
