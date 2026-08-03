/** did repo — Drizzle queries against the `telephony.did_mappings` table. */
import { eq, and, asc, sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { didMappings, type DidMappingRow, type DidMappingInsert, type DidMappingView } from "./schema.js";
import type { DidMapping } from "./domain.js";

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
  return withTenantScope(db, tenantId, async (tx) => {
    const rows = await (tx as typeof db)
      .select()
      .from(didMappings)
      .where(and(eq(didMappings.id, id), eq(didMappings.tenantId, tenantId)))
      .limit(1);
    return rows[0] ? toView(rows[0]) : null;
  }) as Promise<DidMappingView | null>;
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<DidMappingView[]> {
  return withTenantScope(db, tenantId, async (tx) => {
    const rows = await (tx as typeof db)
      .select()
      .from(didMappings)
      .where(eq(didMappings.tenantId, tenantId))
      .orderBy(asc(didMappings.didNumber))
      .limit(limit)
      .offset(offset);
    return rows.map(toView);
  }) as Promise<DidMappingView[]>;
}

/**
 * Candidate mappings for one dialed number, across every tenant.
 *
 * Inbound routing is pre-tenant: the dialed number is what identifies the
 * tenant, so this lookup cannot run inside a tenant scope, and under FORCE RLS
 * a tenant-scoped SELECT can never see the owning tenant's row. It therefore
 * goes through the SECURITY DEFINER helper `telephony.did_mappings_for_number`
 * (migration 0014), which returns only active rows whose normalised DID equals
 * the normalised number the caller already knows — never a general
 * cross-tenant read of the table.
 */
export async function findMappingsForNumber(didNumber: string): Promise<DidMapping[]> {
  if (!didNumber) return [];
  const rows = (await db.execute(
    sql`SELECT did_number, tenant_id, active FROM telephony.did_mappings_for_number(${didNumber})`,
  )) as unknown as Array<{ did_number: string; tenant_id: string; active: boolean }>;
  return rows.map((r) => ({ didNumber: r.did_number, tenantId: r.tenant_id, active: r.active }));
}

export type Writer = Pick<typeof db, "insert" | "update" | "delete" | "select">;

export async function insert(tx: Writer, row: DidMappingInsert): Promise<void> {
  await tx.insert(didMappings).values(row);
}

/**
 * Delete one mapping. Returns the removed DID number so the caller can drop the
 * matching per-number resolution cache entry, or null when nothing matched.
 */
export async function remove(tx: Writer, id: string, tenantId: string): Promise<string | null> {
  const deleted = await tx
    .delete(didMappings)
    .where(and(eq(didMappings.id, id), eq(didMappings.tenantId, tenantId)))
    .returning({ didNumber: didMappings.didNumber });
  return deleted[0]?.didNumber ?? null;
}
