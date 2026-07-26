/**
 * org-hierarchy repository.
 *
 * RLS: tenant.org_units has FORCED row-level security (migration 0017). The GUC
 * `app.tenant_id` is only set inside a wrapped db.transaction() when a tenant
 * context is active. Bare `db.select()` outside that context sees ZERO rows
 * (fail-closed). Therefore EVERY read here runs inside
 * `runWithTenant(tenantId, () => db.transaction(...))` — the same proven pattern
 * as tenant/repo.ts — so RLS is actually satisfied at runtime rather than
 * silently returning an empty tree.
 *
 * `*Tx` variants operate on a caller-supplied transaction (used by consumers,
 * which already run inside runWithTenant + db.transaction).
 */
import { eq, and, isNull, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { orgUnits, type OrgUnitRow } from "./schema.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Run a read under the tenant GUC so RLS returns the tenant's rows. */
function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
}

export function listOrgUnits(tenantId: string): Promise<OrgUnitRow[]> {
  return scoped(tenantId, (tx) =>
    tx.select().from(orgUnits).where(eq(orgUnits.tenantId, tenantId)).orderBy(orgUnits.level, orgUnits.name),
  );
}

export function findById(tenantId: string, id: string): Promise<OrgUnitRow | undefined> {
  return scoped(tenantId, (tx) => findByIdTx(tx, tenantId, id));
}

export async function findByIdTx(tx: Tx, tenantId: string, id: string): Promise<OrgUnitRow | undefined> {
  const rows = await tx.select().from(orgUnits)
    .where(and(eq(orgUnits.id, id), eq(orgUnits.tenantId, tenantId))).limit(1);
  return rows[0];
}

export function findChildren(tenantId: string, parentId: string): Promise<OrgUnitRow[]> {
  return scoped(tenantId, (tx) =>
    tx.select().from(orgUnits)
      .where(and(eq(orgUnits.tenantId, tenantId), eq(orgUnits.parentId, parentId)))
      .orderBy(orgUnits.name),
  );
}

export function findRoots(tenantId: string): Promise<OrgUnitRow[]> {
  return scoped(tenantId, (tx) =>
    tx.select().from(orgUnits)
      .where(and(eq(orgUnits.tenantId, tenantId), isNull(orgUnits.parentId)))
      .orderBy(orgUnits.name),
  );
}

/**
 * Full subtree rooted at `rootId` via a single recursive CTE (depth-capped to
 * defend against a corrupt cycle that predates the write-time guard).
 */
export function getSubtree(tenantId: string, rootId: string): Promise<OrgUnitRow[]> {
  return scoped(tenantId, async (tx) => {
    const res = await tx.execute(sql`
      WITH RECURSIVE subtree AS (
        SELECT * FROM tenant.org_units
          WHERE id = ${rootId} AND tenant_id = ${tenantId}
        UNION ALL
        SELECT o.* FROM tenant.org_units o
          JOIN subtree s ON o.parent_id = s.id
          WHERE o.tenant_id = ${tenantId}
      )
      SELECT * FROM subtree LIMIT 1000
    `);
    return extractRows(res).map(mapRow);
  });
}

/**
 * Cycle guard (scoped read for routes): would setting `nodeId`.parent =
 * `newParentId` create a cycle?
 */
export function wouldCreateCycle(tenantId: string, nodeId: string, newParentId: string): Promise<boolean> {
  if (nodeId === newParentId) return Promise.resolve(true);
  return scoped(tenantId, (tx) => wouldCreateCycleTx(tx, tenantId, nodeId, newParentId));
}

/**
 * Cycle guard (tx variant for consumers). True when newParentId === nodeId, or
 * when newParentId is a descendant of nodeId (nodeId is one of newParentId's
 * ancestors).
 */
export async function wouldCreateCycleTx(tx: Tx, tenantId: string, nodeId: string, newParentId: string): Promise<boolean> {
  if (nodeId === newParentId) return true;
  const res = await tx.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM tenant.org_units
        WHERE id = ${newParentId} AND tenant_id = ${tenantId}
      UNION ALL
      SELECT o.id, o.parent_id FROM tenant.org_units o
        JOIN ancestors a ON o.id = a.parent_id
        WHERE o.tenant_id = ${tenantId}
    )
    SELECT 1 AS hit FROM ancestors WHERE id = ${nodeId} LIMIT 1
  `);
  return extractRows(res).length > 0;
}

export async function insertOrgUnit(tx: Tx, data: typeof orgUnits.$inferInsert): Promise<void> {
  await tx.insert(orgUnits).values(data);
}

export async function updateOrgUnit(
  tx: Tx,
  id: string,
  tenantId: string,
  data: Partial<Pick<OrgUnitRow, "name" | "type" | "parentId" | "headUserId" | "code" | "level">>,
): Promise<void> {
  await tx.update(orgUnits).set({ ...data, updatedAt: new Date() })
    .where(and(eq(orgUnits.id, id), eq(orgUnits.tenantId, tenantId)));
}

function extractRows(res: unknown): Record<string, unknown>[] {
  const maybe = res as { rows?: Record<string, unknown>[] };
  return (maybe.rows ?? (res as Record<string, unknown>[])) as Record<string, unknown>[];
}

function mapRow(r: Record<string, unknown>): OrgUnitRow {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    parentId: (r.parent_id as string | null) ?? null,
    name: r.name as string,
    type: r.type as string,
    level: Number(r.level),
    headUserId: (r.head_user_id as string | null) ?? null,
    code: (r.code as string | null) ?? null,
    effectiveFrom: new Date(r.effective_from as string),
    effectiveTo: r.effective_to ? new Date(r.effective_to as string) : null,
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
    createdBy: r.created_by as string,
    version: Number(r.version),
  };
}
