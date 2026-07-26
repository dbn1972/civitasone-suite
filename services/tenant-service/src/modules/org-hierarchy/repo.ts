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

// Depth ceiling for every recursive hierarchy walk. Postgres does NOT push the
// outer LIMIT into the recursive term, so a cyclic data state (which the
// write-time guard + reparent advisory lock are meant to prevent, but which
// could still exist from legacy corruption) would otherwise recurse forever →
// OOM/CPU. Bounding the recursive term itself makes a cyclic walk terminate.
const MAX_HIERARCHY_DEPTH = 1000;

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
 * Full subtree rooted at `rootId` via a single recursive CTE. The recursive term
 * carries a `depth` counter and refuses to descend past MAX_HIERARCHY_DEPTH, so
 * a corrupt cycle (which the write-time guard + reparent advisory lock aim to
 * prevent) degrades to a BOUNDED walk instead of hanging the connection.
 */
export function getSubtree(tenantId: string, rootId: string): Promise<OrgUnitRow[]> {
  return scoped(tenantId, async (tx) => {
    const res = await tx.execute(sql`
      WITH RECURSIVE subtree AS (
        SELECT o.*, 1 AS depth FROM tenant.org_units o
          WHERE o.id = ${rootId} AND o.tenant_id = ${tenantId}
        UNION ALL
        SELECT o.*, s.depth + 1 FROM tenant.org_units o
          JOIN subtree s ON o.parent_id = s.id
          WHERE o.tenant_id = ${tenantId} AND s.depth < ${MAX_HIERARCHY_DEPTH}
      )
      SELECT * FROM subtree LIMIT ${MAX_HIERARCHY_DEPTH}
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
 * ancestors). The ancestor walk is depth-bounded so that if a cycle already
 * exists in the data the guard still terminates instead of hanging.
 */
export async function wouldCreateCycleTx(tx: Tx, tenantId: string, nodeId: string, newParentId: string): Promise<boolean> {
  if (nodeId === newParentId) return true;
  const res = await tx.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, 1 AS depth FROM tenant.org_units
        WHERE id = ${newParentId} AND tenant_id = ${tenantId}
      UNION ALL
      SELECT o.id, o.parent_id, a.depth + 1 FROM tenant.org_units o
        JOIN ancestors a ON o.id = a.parent_id
        WHERE o.tenant_id = ${tenantId} AND a.depth < ${MAX_HIERARCHY_DEPTH}
    )
    SELECT 1 AS hit FROM ancestors WHERE id = ${nodeId} LIMIT 1
  `);
  return extractRows(res).length > 0;
}

/**
 * Serialize the cycle-check + reparent for a tenant across worker replicas.
 * Under READ COMMITTED two concurrent reparents ("X under Y" + "Y under X")
 * could each pass an independent cycle check on a stale snapshot and both
 * commit, producing a cycle. A per-tenant transaction-scoped advisory lock
 * (auto-released at COMMIT/ROLLBACK) forces those reparents to run one at a
 * time so the second observes the first's committed edge. Matches the
 * pg_advisory_xact_lock style used by the procurement scorecard consumer.
 */
export async function lockTenantForReparent(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}::text))`);
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
