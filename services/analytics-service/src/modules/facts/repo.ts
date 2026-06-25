/**
 * facts repo — writes/reads analytics' OWN projection table.
 * Ingestion is idempotent at the row level via the (tenant_id, dedupe_key)
 * unique index; we use ON CONFLICT DO NOTHING so a redelivered domain event
 * never double-counts.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { factEvents, type FactEventInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function ingest(tx: Writer, row: FactEventInsert): Promise<void> {
  await tx
    .insert(factEvents)
    .values(row)
    .onConflictDoNothing({ target: [factEvents.tenantId, factEvents.dedupeKey] });
}

/** Total fact rows for a tenant (used by tenant-isolation tests + health stats). */
export async function countByTenant(tenantId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(factEvents)
    .where(eq(factEvents.tenantId, tenantId));
  return rows[0]?.n ?? 0;
}

export async function existsDedupe(tenantId: string, dedupeKey: string): Promise<boolean> {
  const rows = await db
    .select({ id: factEvents.id })
    .from(factEvents)
    .where(and(eq(factEvents.tenantId, tenantId), eq(factEvents.dedupeKey, dedupeKey)))
    .limit(1);
  return rows.length > 0;
}
