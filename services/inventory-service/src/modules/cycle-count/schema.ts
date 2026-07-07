/**
 * cycle-count module — Drizzle schema for cycle count records.
 *
 * Tracks physical vs system count comparisons, variance calculations,
 * and approval status. Each cycle count generates an adjustment transaction
 * either automatically (within threshold) or after approval.
 *
 * All money is stored as bigint paise. Every table is tenant-scoped with
 * optimistic locking via `version`.
 */
import { pgSchema, uuid, varchar, integer, bigint, timestamp, text } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("inventory");

export const cycleCounts = domainSchema.table("cycle_counts", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  itemId:              uuid("item_id").notNull(),
  warehouseId:         uuid("warehouse_id").notNull(),
  systemQty:           integer("system_qty").notNull(),
  physicalQty:         integer("physical_qty").notNull(),
  variance:            integer("variance").notNull(),
  absVariance:         integer("abs_variance").notNull(),
  autoAdjustThreshold: integer("auto_adjust_threshold").notNull(),
  reasonCode:          varchar("reason_code", { length: 64 }).notNull(),
  status:              varchar("status", { length: 32 }).notNull().default("pending"),
  approvedBy:          uuid("approved_by"),
  approvedAt:          timestamp("approved_at", { withTimezone: true }),
  rejectedBy:          uuid("rejected_by"),
  rejectedAt:          timestamp("rejected_at", { withTimezone: true }),
  rejectionReason:     text("rejection_reason"),
  adjustmentId:        uuid("adjustment_id"),
  countedAt:           timestamp("counted_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

export type CycleCountRow = typeof cycleCounts.$inferSelect;
export type CycleCountInsert = typeof cycleCounts.$inferInsert;

export const schema = { cycleCounts };
