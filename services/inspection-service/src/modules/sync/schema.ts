/**
 * inspection-service: sync module Drizzle schema.
 *
 * Defines the `sync` PG schema with tables for offline data synchronization:
 * - sync_packages — offline data bundles (checklists, entity data, map tiles) for field inspectors
 * - sync_uploads — queued offline inspection results awaiting processing
 * - sync_cursors — per-device sequence tracking for partial resume
 *
 * _Requirements: 6.1, 6.2, 6.6, 6.8_
 */
import {
  pgSchema,
  uuid,
  text,
  integer,
  varchar,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/** The `sync` PG schema — offline packages, upload queue, and cursor tracking. */
export const syncSchema = pgSchema("sync");

// ── sync.sync_packages ────────────────────────────────────────────────────────
/**
 * Offline data bundles containing assigned inspections, checklist instances,
 * entity data, and map tiles for field use. Status tracks the generation
 * lifecycle: generating → ready → expired.
 *
 * ### `inspectionIds` JSONB shape:
 * ```ts
 * type InspectionIds = string[]; // uuid[]
 * ```
 */
export const syncPackages = syncSchema.table("sync_packages", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  inspectorId:   uuid("inspector_id").notNull(),
  inspectionIds: jsonb("inspection_ids").notNull(), // uuid[]
  status:        varchar("status", { length: 16 }).notNull().default("generating"), // generating|ready|expired
  checksum:      text("checksum"), // SHA-256 of package
  s3Key:         text("s3_key"),
  sizeBytes:     integer("size_bytes"),
  generatedAt:   timestamp("generated_at", { withTimezone: true }),
  expiresAt:     timestamp("expires_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  version:       integer("version").notNull().default(1),
}, (table) => ({
  indexTenantInspector: index("idx_sync_packages_tenant_inspector")
    .on(table.tenantId, table.inspectorId),
  indexTenantStatus: index("idx_sync_packages_tenant_status")
    .on(table.tenantId, table.status),
}));

// ── sync.sync_uploads ─────────────────────────────────────────────────────────
/**
 * Queued offline inspection results submitted by field devices. Each upload is
 * uniquely identified by (tenantId, inspectionId, deviceId, sequenceNumber) for
 * idempotent processing and partial resume support.
 *
 * ### `payload` JSONB shape:
 * ```ts
 * type SyncUploadPayload = {
 *   responses: Record<string, { value: unknown; answeredAt: string }>;
 *   evidence: Array<{ evidenceId: string; sha256: string }>;
 * };
 * ```
 */
export const syncUploads = syncSchema.table("sync_uploads", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  inspectorId:    uuid("inspector_id").notNull(),
  inspectionId:   uuid("inspection_id").notNull(),
  deviceId:       text("device_id").notNull(),
  sequenceNumber: integer("sequence_number").notNull(),
  payload:        jsonb("payload").notNull(),
  sha256Hash:     text("sha256_hash"),
  networkState:   varchar("network_state", { length: 16 }).notNull().default("offline"), // online|offline
  status:         varchar("status", { length: 16 }).notNull().default("pending"), // pending|processed|skipped
  processedAt:    timestamp("processed_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  version:        integer("version").notNull().default(1),
}, (table) => ({
  uniqueTenantInspectionDeviceSeq: uniqueIndex("idx_sync_uploads_tenant_inspection_device_seq")
    .on(table.tenantId, table.inspectionId, table.deviceId, table.sequenceNumber),
  indexTenantInspector: index("idx_sync_uploads_tenant_inspector")
    .on(table.tenantId, table.inspectorId),
  indexTenantInspection: index("idx_sync_uploads_tenant_inspection")
    .on(table.tenantId, table.inspectionId),
}));

// ── sync.sync_cursors ─────────────────────────────────────────────────────────
/**
 * Tracks the last acknowledged sequence number per device+inspection for partial
 * resume. On interrupted upload, clients resume from lastAckedSeq + 1.
 *
 * Protocol:
 * - If sequenceNumber ≤ lastAckedSeq → skip (idempotent success)
 * - If sequenceNumber > lastAckedSeq + 1 → reject (gap detected, 422)
 * - On success → update lastAckedSeq = sequenceNumber
 */
export const syncCursors = syncSchema.table("sync_cursors", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  inspectorId:  uuid("inspector_id").notNull(),
  inspectionId: uuid("inspection_id").notNull(),
  deviceId:     text("device_id").notNull(),
  lastAckedSeq: integer("last_acked_seq").notNull().default(0),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:      integer("version").notNull().default(1),
}, (table) => ({
  indexTenantInspectorDevice: index("idx_sync_cursors_tenant_inspector_device")
    .on(table.tenantId, table.inspectorId, table.inspectionId, table.deviceId),
}));

// ── Inferred types ────────────────────────────────────────────────────────────
export type SyncPackageRow = typeof syncPackages.$inferSelect;
export type SyncPackageInsert = typeof syncPackages.$inferInsert;
export type SyncUploadRow = typeof syncUploads.$inferSelect;
export type SyncUploadInsert = typeof syncUploads.$inferInsert;
export type SyncCursorRow = typeof syncCursors.$inferSelect;
export type SyncCursorInsert = typeof syncCursors.$inferInsert;

export const schema = { syncPackages, syncUploads, syncCursors };
