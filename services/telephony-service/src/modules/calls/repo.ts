/**
 * calls repo — Drizzle queries against domain schema ONLY.
 */
import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { calls, type CallRow, type CallInsert, type CallView } from "./schema.js";

function toView(r: CallRow): CallView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    callerNumber: r.callerNumber,
    status: r.status,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<CallView | null> {
  const rows = await db.select().from(calls).where(eq(calls.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<CallView[]> {
  const rows = await db.select().from(calls)
    .where(eq(calls.tenantId, tenantId))
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: CallInsert): Promise<void> {
  await tx.insert(calls).values(row);
}

export { toView };
