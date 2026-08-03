/** did repo — Drizzle queries against the `telephony.did_mappings` table. */
import { eq, and, asc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { didMappings, type DidMappingRow, type DidMappingInsert, type DidMappingView } from "./schema.js";

export function toView(r: DidMappingRow): DidMappingView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    didNumber: r.didNumber,
    label: r.label ?? null,
    active: r.active,
    createdAt: r.createdAt.toISOString(),
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<DidMappingView | null> {
  const rows = await db
    .select()
    .from(didMappings)
    .where(and(eq(didMappings.id, id), eq(didMappings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function findByDidNumber(didNumber: string): Promise<DidMappingView | null> {
  const rows = await db
    .select()
    .from(didMappings)
    .where(and(eq(didMappings.didNumber, didNumber), eq(didMappings.active, true)))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<DidMappingView[]> {
  const rows = await db
    .select()
    .from(didMappings)
    .where(eq(didMappings.tenantId, tenantId))
    .orderBy(asc(didMappings.didNumber))
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

export async function listAllActive(): Promise<DidMappingView[]> {
  const rows = await db
    .select()
    .from(didMappings)
    .where(eq(didMappings.active, true))
    .orderBy(asc(didMappings.didNumber));
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "delete" | "select">;

export async function insert(tx: Writer, row: DidMappingInsert): Promise<void> {
  await tx.insert(didMappings).values(row);
}

export async function remove(tx: Writer, id: string, tenantId: string): Promise<number> {
  const deleted = await tx
    .delete(didMappings)
    .where(and(eq(didMappings.id, id), eq(didMappings.tenantId, tenantId)))
    .returning({ id: didMappings.id });
  return deleted.length;
}
