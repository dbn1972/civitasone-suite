/**
 * srn module — Drizzle schema for Store Receipt Notes (SRN), PG schema `inventory`.
 *
 * A Store Receipt Note records the store officer's physical acceptance of a
 * GRN into store — GFR Rule 149 requires a signed SRN before any payment
 * against that GRN can be authorised (Req 1.1). The three-way-match consumer
 * gates `payment.released` on `status === 'signed'` here.
 *
 * `grnId` is a plain uuid, not a foreign key: inventory-service and
 * procurement-service are separate physical databases
 * (civitas_inventory / civitas_procurement), so there is no cross-database
 * FK to `grn.procurement_grns(id)` — see migrations/0017_store_receipt_notes.sql
 * and docs/DATABASE-SCHEMA.md §6. Referential integrity across services is
 * eventual, via events, per platform convention.
 */
import { pgSchema, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("inventory");

export const storeReceiptNotes = domainSchema.table("store_receipt_notes", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  grnId:           uuid("grn_id").notNull(),
  storeOfficerId:  uuid("store_officer_id").notNull(),
  receivedAt:      timestamp("received_at", { withTimezone: true }),
  remarks:         text("remarks"),
  status:          text("status").notNull().default("draft"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StoreReceiptNoteRow    = typeof storeReceiptNotes.$inferSelect;
export type StoreReceiptNoteInsert = typeof storeReceiptNotes.$inferInsert;

export const schema = { storeReceiptNotes };
