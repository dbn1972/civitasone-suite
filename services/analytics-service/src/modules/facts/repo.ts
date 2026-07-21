/**
 * facts repo — writes/reads analytics' OWN projection table.
 * Ingestion is idempotent at the row level via the (tenant_id, dedupe_key)
 * unique index; we use ON CONFLICT DO NOTHING so a redelivered domain event
 * never double-counts.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { factEvents, type FactEventInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function ingest(tx: Writer, row: FactEventInsert): Promise<void> {
  // Idempotency is guaranteed by the inbox: ingestEvent() calls markProcessed()
  // FIRST in the same transaction, so a redelivered messageId never reaches this
  // insert. fact_events is PARTITION BY RANGE (ingested_at); on a partitioned
  // table every unique index must include the partition key, so a (tenant_id,
  // dedupe_key) arbiter cannot exist (and the 2-col target threw 42P10). We keep
  // a targetless ON CONFLICT DO NOTHING as a harmless secondary net against any
  // unique violation (e.g. the primary key) without coupling to a specific index.
  await tx.insert(factEvents).values(row).onConflictDoNothing();
}

/** Total fact rows for a tenant (used by tenant-isolation tests + health stats). */
export async function countByTenant(tenantId: string): Promise<number> {
  const rows = await scopedRead(async (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(factEvents)
      .where(eq(factEvents.tenantId, tenantId)),
  );
  return rows[0]?.n ?? 0;
}

export async function existsDedupe(tenantId: string, dedupeKey: string): Promise<boolean> {
  const rows = await scopedRead(async (tx) =>
    tx
      .select({ id: factEvents.id })
      .from(factEvents)
      .where(and(eq(factEvents.tenantId, tenantId), eq(factEvents.dedupeKey, dedupeKey)))
      .limit(1),
  );
  return rows.length > 0;
}
