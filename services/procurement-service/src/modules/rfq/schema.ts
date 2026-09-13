import { pgSchema, uuid, text, integer, varchar, date, timestamp, jsonb, bigint, boolean } from "drizzle-orm/pg-core";

export const rfqSchema = pgSchema("rfq");

export const procurementRfqs = rfqSchema.table("procurement_rfqs", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  rfqNo:             text("rfq_no").notNull(),
  title:             text("title").notNull(),
  description:       text("description"),
  indentRef:         text("indent_ref"),
  vendorsInvited:    integer("vendors_invited").notNull().default(0),
  responsesReceived: integer("responses_received").notNull().default(0),
  closingDate:       date("closing_date").notNull().defaultNow(),
  status:            varchar("status", { length: 16 }).notNull().default("draft"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
  // DOM-011: close/award lifecycle (see migration 0034 + rfq/domain.ts).
  closedAt:           timestamp("closed_at", { withTimezone: true }),
  awardedAt:          timestamp("awarded_at", { withTimezone: true }),
  // FK-style pointer, no DB-level REFERENCES -- mirrors this service's own
  // convention for "winning" pointers (see tender.procurement_tenders's
  // awardedBidId/awardedVendorId).
  awardedResponseId:  uuid("awarded_response_id"),
});

export const procurementRfqItems = rfqSchema.table("procurement_rfq_items", {
  id:        uuid("id").primaryKey().defaultRandom(),
  rfqId:     uuid("rfq_id").notNull(),
  tenantId:  uuid("tenant_id").notNull(),
  itemName:  text("item_name").notNull(),
  quantity:  integer("quantity").notNull().default(1),
  unit:      varchar("unit", { length: 32 }).notNull().default("nos"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

/**
 * DOM-011: a vendor's response to an RFQ. Denormalized `items` snapshot
 * (rather than a separate item-rows table) because a response is immutable
 * once submitted -- no amend/withdraw flow exists, mirroring how a tender bid
 * is also never mutated after submission. `totalAmountMinor` is computed
 * server-side by the consumer (see rfq/consumer.ts), never trusted from the
 * client. `status`: submitted -> awarded | rejected (set together, in the
 * same transaction, when the RFQ itself is awarded -- see
 * rfq/domain.ts/consumer.ts).
 */
export const procurementRfqResponses = rfqSchema.table("procurement_rfq_responses", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  rfqId:            uuid("rfq_id").notNull(),
  vendorId:         uuid("vendor_id").notNull(),
  items:            jsonb("items").notNull().default([]),
  totalAmountMinor: bigint("total_amount_minor", { mode: "bigint" }).notNull().default(0n),
  validUntil:       date("valid_until"),
  termsAccepted:    boolean("terms_accepted").notNull().default(false),
  remarks:          text("remarks"),
  status:           varchar("status", { length: 16 }).notNull().default("submitted"),
  submittedAt:      timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export type RfqRow    = typeof procurementRfqs.$inferSelect;
export type RfqInsert = typeof procurementRfqs.$inferInsert;
export type RfqResponseRow    = typeof procurementRfqResponses.$inferSelect;
export type RfqResponseInsert = typeof procurementRfqResponses.$inferInsert;

export const schema = { procurementRfqs, procurementRfqItems, procurementRfqResponses };
