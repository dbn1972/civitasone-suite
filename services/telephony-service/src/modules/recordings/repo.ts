/**
 * recordings repo — DB queries for call recordings. Tenant-scoped on every operation.
 */
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { withTenantScope } from "@civitasone/db";
import { recordings, type RecordingRow, type RecordingInsert, type RecordingView } from "./schema.js";

function toView(r: RecordingRow): RecordingView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    callId: r.callId,
    recordingUrl: r.recordingUrl,
    storageKey: r.storageKey ?? null,
    durationSec: r.durationSec ?? null,
    format: r.format,
    status: r.status,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/** Insert a new recording record. */
export async function insert(tx: Writer, row: RecordingInsert): Promise<void> {
  await tx.insert(recordings).values(row);
}

/** Find a recording by ID and tenant. */
export async function findById(tenantId: string, id: string): Promise<RecordingView | null> {
  const rows = await db
    .select()
    .from(recordings)
    .where(and(eq(recordings.id, id), eq(recordings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

/** List all recordings for a call. */
export async function listByCall(tenantId: string, callId: string): Promise<RecordingView[]> {
  return withTenantScope(db, tenantId, async (tx) => {
    const rows = await (tx as typeof db)
      .select()
      .from(recordings)
      .where(and(eq(recordings.tenantId, tenantId), eq(recordings.callId, callId)))
      .orderBy(recordings.createdAt);
    return rows.map(toView);
  }) as Promise<RecordingView[]>;
}

/** Update recording with storage key after successful upload. */
export async function markStored(
  tx: Writer,
  id: string,
  tenantId: string,
  storageKey: string,
  actorId: string,
): Promise<number> {
  const updated = await (tx as typeof db)
    .update(recordings)
    .set({
      storageKey,
      status: "stored",
      updatedAt: new Date(),
      updatedBy: actorId,
      version: sql`${recordings.version} + 1`,
    })
    .where(and(eq(recordings.id, id), eq(recordings.tenantId, tenantId)))
    .returning({ id: recordings.id });
  return updated.length;
}

/** Mark recording as failed. */
export async function markFailed(
  tx: Writer,
  id: string,
  tenantId: string,
  actorId: string,
): Promise<number> {
  const updated = await (tx as typeof db)
    .update(recordings)
    .set({
      status: "failed",
      updatedAt: new Date(),
      updatedBy: actorId,
      version: sql`${recordings.version} + 1`,
    })
    .where(and(eq(recordings.id, id), eq(recordings.tenantId, tenantId)))
    .returning({ id: recordings.id });
  return updated.length;
}
