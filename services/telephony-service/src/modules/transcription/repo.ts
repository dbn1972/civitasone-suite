/**
 * transcription repo — DB queries for call transcripts. Tenant-scoped on every operation.
 */
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { transcripts, type TranscriptRow, type TranscriptInsert, type TranscriptView } from "./schema.js";

function toView(r: TranscriptRow): TranscriptView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    callId: r.callId,
    recordingId: r.recordingId,
    text: r.text,
    status: r.status,
    durationMs: r.durationMs ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/** Insert a new transcript record in pending state. */
export async function insert(tx: Writer, row: TranscriptInsert): Promise<void> {
  await tx.insert(transcripts).values(row);
}

/** Find a transcript by call ID and tenant. */
export async function findByCallId(tenantId: string, callId: string): Promise<TranscriptView | null> {
  const rows = await db
    .select()
    .from(transcripts)
    .where(and(eq(transcripts.callId, callId), eq(transcripts.tenantId, tenantId)))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

/** Find a transcript by recording ID and tenant. */
export async function findByRecordingId(tenantId: string, recordingId: string): Promise<TranscriptView | null> {
  const rows = await db
    .select()
    .from(transcripts)
    .where(and(eq(transcripts.recordingId, recordingId), eq(transcripts.tenantId, tenantId)))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

/** Mark transcript as processing. */
export async function markProcessing(
  tx: Writer,
  id: string,
  tenantId: string,
  actorId: string,
): Promise<number> {
  const updated = await (tx as typeof db)
    .update(transcripts)
    .set({
      status: "processing",
      updatedAt: new Date(),
      updatedBy: actorId,
      version: sql`${transcripts.version} + 1`,
    })
    .where(and(eq(transcripts.id, id), eq(transcripts.tenantId, tenantId)))
    .returning({ id: transcripts.id });
  return updated.length;
}

/** Mark transcript as completed with the transcription text. */
export async function markCompleted(
  tx: Writer,
  id: string,
  tenantId: string,
  text: string,
  durationMs: number,
  actorId: string,
): Promise<number> {
  const updated = await (tx as typeof db)
    .update(transcripts)
    .set({
      text,
      durationMs,
      status: "completed",
      updatedAt: new Date(),
      updatedBy: actorId,
      version: sql`${transcripts.version} + 1`,
    })
    .where(and(eq(transcripts.id, id), eq(transcripts.tenantId, tenantId)))
    .returning({ id: transcripts.id });
  return updated.length;
}

/** Mark transcript as failed. */
export async function markFailed(
  tx: Writer,
  id: string,
  tenantId: string,
  actorId: string,
): Promise<number> {
  const updated = await (tx as typeof db)
    .update(transcripts)
    .set({
      status: "failed",
      updatedAt: new Date(),
      updatedBy: actorId,
      version: sql`${transcripts.version} + 1`,
    })
    .where(and(eq(transcripts.id, id), eq(transcripts.tenantId, tenantId)))
    .returning({ id: transcripts.id });
  return updated.length;
}
