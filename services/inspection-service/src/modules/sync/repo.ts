/**
 * inspection-service: sync module — data access (repository).
 *
 * Read-through via `cache.getOrLoad` for single-entity lookups.
 * All queries are scoped by tenant_id for RLS-compatible isolation.
 * Writes use Drizzle ORM within transaction contexts passed from the consumer.
 *
 * Cache key pattern: `inspection:{tenantId}:sync_pkg:{id}`
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.6, 6.8_
 */
import { eq, and, sql } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import {
  syncPackages,
  syncUploads,
  syncCursors,
  type SyncPackageRow,
  type SyncPackageInsert,
  type SyncUploadRow,
  type SyncUploadInsert,
  type SyncCursorRow,
} from "./schema.js";

// ── Type Aliases ──────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface PaginationInput {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

// ── Sync Packages ─────────────────────────────────────────────────────────────

/**
 * Find a sync package by ID with cache read-through.
 */
export async function findPackageById(
  tenantId: string,
  id: string,
): Promise<SyncPackageRow | null> {
  return cache.getOrLoad<SyncPackageRow>(
    cache.makeKey(tenantId, "sync_pkg", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(syncPackages)
          .where(and(
            eq(syncPackages.id, id),
            eq(syncPackages.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

/**
 * Find packages by inspector (list query — not cached individually).
 */
export async function findPackagesByInspector(
  tenantId: string,
  inspectorId: string,
  pagination: PaginationInput,
): Promise<PaginatedResult<SyncPackageRow>> {
  return scopedRead(async (tx) => {
    const whereClause = and(
      eq(syncPackages.tenantId, tenantId),
      eq(syncPackages.inspectorId, inspectorId),
    );

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(syncPackages)
        .where(whereClause),
      tx.select().from(syncPackages)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(syncPackages.createdAt),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, total },
    };
  });
}

/**
 * Insert a new sync package within a transaction.
 */
export async function insertPackage(
  tx: Tx,
  data: SyncPackageInsert,
): Promise<SyncPackageRow> {
  const rows = await tx.insert(syncPackages).values(data).returning();
  return rows[0]!;
}

/**
 * Update sync package status and metadata (e.g., mark ready with checksum/s3Key).
 */
export async function updatePackage(
  tx: Tx,
  id: string,
  tenantId: string,
  patch: Partial<Pick<SyncPackageRow, "status" | "checksum" | "s3Key" | "sizeBytes" | "generatedAt" | "expiresAt">>,
): Promise<SyncPackageRow> {
  const rows = await tx.update(syncPackages)
    .set({ ...patch, updatedAt: new Date(), version: sql`${syncPackages.version} + 1` })
    .where(and(
      eq(syncPackages.id, id),
      eq(syncPackages.tenantId, tenantId),
    ))
    .returning();
  return rows[0]!;
}

// ── Sync Uploads ──────────────────────────────────────────────────────────────

/**
 * Insert a sync upload record within a transaction.
 */
export async function insertUpload(
  tx: Tx,
  data: SyncUploadInsert,
): Promise<SyncUploadRow> {
  const rows = await tx.insert(syncUploads).values(data).returning();
  return rows[0]!;
}

/**
 * Find an existing upload by tenant + inspection + device + sequence (idempotency check).
 */
export async function findUploadBySequence(
  tx: Tx,
  tenantId: string,
  inspectionId: string,
  deviceId: string,
  sequenceNumber: number,
): Promise<SyncUploadRow | null> {
  const rows = await tx.select().from(syncUploads)
    .where(and(
      eq(syncUploads.tenantId, tenantId),
      eq(syncUploads.inspectionId, inspectionId),
      eq(syncUploads.deviceId, deviceId),
      eq(syncUploads.sequenceNumber, sequenceNumber),
    ));
  return rows[0] ?? null;
}

/**
 * Mark an upload as processed.
 */
export async function markUploadProcessed(
  tx: Tx,
  id: string,
): Promise<void> {
  await tx.update(syncUploads)
    .set({ status: "processed", processedAt: new Date() })
    .where(eq(syncUploads.id, id));
}

// ── Sync Cursors ──────────────────────────────────────────────────────────────

/**
 * Get or create a cursor for a specific tenant + inspection + device combination.
 */
export async function getOrCreateCursor(
  tx: Tx,
  tenantId: string,
  inspectorId: string,
  inspectionId: string,
  deviceId: string,
): Promise<SyncCursorRow> {
  // Try to find existing cursor
  const existing = await tx.select().from(syncCursors)
    .where(and(
      eq(syncCursors.tenantId, tenantId),
      eq(syncCursors.inspectorId, inspectorId),
      eq(syncCursors.inspectionId, inspectionId),
      eq(syncCursors.deviceId, deviceId),
    ));

  if (existing[0]) return existing[0];

  // Create new cursor with lastAckedSeq = 0
  const rows = await tx.insert(syncCursors).values({
    tenantId,
    inspectorId,
    inspectionId,
    deviceId,
    lastAckedSeq: 0,
  }).returning();
  return rows[0]!;
}

/**
 * Update cursor's lastAckedSeq after successful upload processing.
 */
export async function updateCursorSeq(
  tx: Tx,
  cursorId: string,
  newSeq: number,
): Promise<void> {
  await tx.update(syncCursors)
    .set({
      lastAckedSeq: newSeq,
      updatedAt: new Date(),
      version: sql`${syncCursors.version} + 1`,
    })
    .where(eq(syncCursors.id, cursorId));
}

/**
 * Get sync status for an inspector — returns all cursors grouped by device/inspection.
 */
export async function findCursorsByInspector(
  tenantId: string,
  inspectorId: string,
): Promise<SyncCursorRow[]> {
  return scopedRead((tx) =>
    tx.select().from(syncCursors)
      .where(and(
        eq(syncCursors.tenantId, tenantId),
        eq(syncCursors.inspectorId, inspectorId),
      )),
  );
}
