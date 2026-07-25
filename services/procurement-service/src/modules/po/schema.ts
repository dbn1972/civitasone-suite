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
  // SVC-046: distinguishes a supply Purchase Order from a service / work order.
  orderType:       varchar("order_type", { length: 16 }).notNull().default("supply"),
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

/**
 * SVC-046: PO / Work-order amendment + change-order versioning. Each amendment
 * captures a monotonically-increasing amendment_no per PO with a value delta and
 * maker-checker approval (pending -> approved / rejected).
 */
export const procurementPoAmendments = poSchema.table("procurement_po_amendments", {
  id:             uuid("id").primaryKey().defaultRandom(),
  poId:           uuid("po_id").notNull(),
  tenantId:       uuid("tenant_id").notNull(),
  amendmentNo:    integer("amendment_no").notNull(),
  amendmentType:  varchar("amendment_type", { length: 24 }).notNull().default("scope"),
  status:         varchar("status", { length: 16 }).notNull().default("pending"),
  reason:         text("reason").notNull(),
  deltaMinor:     bigint("delta_minor", { mode: "bigint" }).notNull().default(0n),
  prevTotalMinor: bigint("prev_total_minor", { mode: "bigint" }).notNull().default(0n),
  newTotalMinor:  bigint("new_total_minor", { mode: "bigint" }).notNull().default(0n),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  effectiveDate:  date("effective_date"),
  requestedBy:    uuid("requested_by").notNull(),
  approvedBy:     uuid("approved_by"),
  approvedAt:     timestamp("approved_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

/** SVC-046: delivery-schedule / milestone tracking for a PO / work order. */
export const procurementPoMilestones = poSchema.table("procurement_po_milestones", {
  id:            uuid("id").primaryKey().defaultRandom(),
  poId:          uuid("po_id").notNull(),
  tenantId:      uuid("tenant_id").notNull(),
  milestoneNo:   integer("milestone_no").notNull(),
  title:         text("title").notNull(),
  description:   text("description"),
  dueDate:       date("due_date"),
  amountMinor:   bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  deliveredQty:  integer("delivered_qty").notNull().default(0),
  status:        varchar("status", { length: 16 }).notNull().default("pending"),
  completedAt:   timestamp("completed_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
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
  itemType:       varchar("item_type", { length: 16 }).notNull().default("consumable"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type PoRow    = typeof procurementPos.$inferSelect;
export type PoInsert = typeof procurementPos.$inferInsert;
export type PoAmendmentRow    = typeof procurementPoAmendments.$inferSelect;
export type PoAmendmentInsert = typeof procurementPoAmendments.$inferInsert;
export type PoMilestoneRow    = typeof procurementPoMilestones.$inferSelect;
export type PoMilestoneInsert = typeof procurementPoMilestones.$inferInsert;

export const schema = { procurementPos, procurementPoItems, procurementPoAmendments, procurementPoMilestones };
