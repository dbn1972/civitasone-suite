/** queues repo — Drizzle queries against the `telephony` schema ONLY. */
import { eq, and, asc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
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

export async function findById(id: string, tenantId: string): Promise<QueueView | null> {
  const rows = await db.select().from(queues).where(and(eq(queues.id, id), eq(queues.tenantId, tenantId))).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<QueueView[]> {
  const rows = await db
    .select()
    .from(queues)
    .where(eq(queues.tenantId, tenantId))
    .orderBy(asc(queues.name))
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

/** Tenant-scoped existence check (cross-tenant ref guard for call assignment). */
export async function exists(tenantId: string, id: string): Promise<boolean> {
  const rows = await db
    .select({ one: sql`1` })
    .from(queues)
    .where(and(eq(queues.tenantId, tenantId), eq(queues.id, id)))
    .limit(1);
  return rows.length > 0;
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: QueueInsert): Promise<void> {
  await tx.insert(queues).values(row);
}
