import { pgSchema, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

export const ecourtsSchema = pgSchema("ecourts");

/**
 * cause_list_syncs — tracks the last sync per matter (legal case) with e-Courts.
 *
 * Each row represents the sync state for a tracked matter with a CNR number.
 * The consumer uses this to know which matters to poll and when the last
 * successful sync occurred.
 */
export const causeListSyncs = ecourtsSchema.table("cause_list_syncs", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  caseId:        uuid("case_id").notNull(),
  cnrNumber:     text("cnr_number").notNull(),
  lastSyncAt:    timestamp("last_sync_at", { withTimezone: true }),
  lastSyncStatus: text("last_sync_status").notNull().default("pending"),
  lastError:     text("last_error"),
  nextHearingDate: text("next_hearing_date"),
  nextHearingPurpose: text("next_hearing_purpose"),
  ordersDownloaded: integer("orders_downloaded").notNull().default(0),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type CauseListSyncRow = typeof causeListSyncs.$inferSelect;
export type CauseListSyncInsert = typeof causeListSyncs.$inferInsert;
export const syncSchema = { causeListSyncs };
