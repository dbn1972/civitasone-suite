/** queues repo — Drizzle queries against the `telephony` schema ONLY. */
import { eq, and, asc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { runWithTenant } from "@civitasone/db";
import { queues, type QueueRow, type QueueInsert, type QueueView } from "./schema.js";

export function toView(r: QueueRow): QueueView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    description: r.description ?? null,
    slaAnswerSeconds: r.slaAnswerSeconds,
    status: r.status,
    version: r.version,
  };
}


/**
 * Run a tenant-scoped READ inside a GUC transaction so forced RLS returns this
 * tenant's rows (wrapWithTenantGuc only sets app.tenant_id inside db.transaction()
 * and only when a tenant context is active). Without this a bare db.select() runs
 * with no GUC and RLS returns zero rows.
 */
function readScoped<T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () =>
    db.transaction(fn as Parameters<typeof db.transaction>[0]),
  ) as Promise<T>;
}

export async function findById(id: string, tenantId: string): Promise<QueueView | null> {
  const rows = await readScoped(tenantId, (tx) =>
    tx.select().from(queues).where(and(eq(queues.id, id), eq(queues.tenantId, tenantId))).limit(1),
  );
  return rows[0] ? toView(rows[0]) : null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<QueueView[]> {
  const rows = await readScoped(tenantId, (tx) =>
    tx
      .select()
      .from(queues)
      .where(eq(queues.tenantId, tenantId))
      .orderBy(asc(queues.name))
      .limit(limit)
      .offset(offset),
  );
  return rows.map(toView);
}

/** Tenant-scoped existence check (cross-tenant ref guard for call assignment). */
export async function exists(tenantId: string, id: string): Promise<boolean> {
  const rows = await readScoped(tenantId, (tx) =>
    tx
      .select({ one: sql`1` })
      .from(queues)
      .where(and(eq(queues.tenantId, tenantId), eq(queues.id, id)))
      .limit(1),
  );
  return rows.length > 0;
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: QueueInsert): Promise<void> {
  await tx.insert(queues).values(row);
}
