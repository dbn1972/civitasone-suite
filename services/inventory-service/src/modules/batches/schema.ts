/**
 * batches module — Drizzle schema for batch and serial number tracking.
 *
 * Batch tracking: batch number (max 64 chars), manufacture date, expiry date,
 * quantity, and status. Each batch is linked to an item and tenant.
 *
 * Serial tracking: per-item unique serial numbers with status lifecycle.
 * Serial numbers are unique per item per tenant (enforced by DB constraint).
 *
 * All tables are tenant-scoped with optimistic locking via `version`.
 *
 * Validates: Requirements 14.5, 14.6
 */
import { pgSchema, uuid, varchar, integer, date, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("inventory");

export const batches = domainSchema.table("batches", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  itemId:      uuid("item_id").notNull(),
  batchNumber: varchar("batch_number", { length: 64 }).notNull(),
  mfgDate:     date("mfg_date").notNull(),
  expiryDate:  date("expiry_date").notNull(),
  qty:         integer("qty").notNull().default(0),
  status:      varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const serialNumbers = domainSchema.table("serial_numbers", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  itemId:       uuid("item_id").notNull(),
  batchId:      uuid("batch_id"),
  serialNumber: varchar("serial_number", { length: 128 }).notNull(),
  status:       varchar("status", { length: 24 }).notNull().default("available"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type BatchRow = typeof batches.$inferSelect;
export type BatchInsert = typeof batches.$inferInsert;
export type SerialNumberRow = typeof serialNumbers.$inferSelect;
export type SerialNumberInsert = typeof serialNumbers.$inferInsert;

export const schema = { batches, serialNumbers };
