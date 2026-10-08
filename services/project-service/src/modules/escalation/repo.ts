import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  projectEscalations,
  type EscalationRow,
  type EscalationInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * All persisted escalation records for a tenant, as a projectId → row map. Read
 * through db.transaction() so wrapWithTenantGuc injects app.tenant_id before
 * the read (a bare db.select() runs with no RLS GUC set). Used by the list
 * endpoint to OVERLAY persisted action state onto the synthetic projection.
 */
export async function listByTenant(tenantId: string, limit = 500): Promise<EscalationRow[]> {
  return db.transaction((tx) => tx.select().from(projectEscalations)
    .where(eq(projectEscalations.tenantId, tenantId))
    .orderBy(desc(projectEscalations.updatedAt))
    .limit(limit));
}

/** Persisted records for a set of project ids (tenant-scoped) — overlay lookup. */
export async function listByProjectIdsTx(
  tx: Writer, tenantId: string, projectIds: string[],
): Promise<EscalationRow[]> {
  if (projectIds.length === 0) return [];
  return tx.select().from(projectEscalations)
    .where(and(
      eq(projectEscalations.tenantId, tenantId),
      inArray(projectEscalations.projectId, projectIds),
    ))
    // Bounded: the projection itself limits to 200 projects, so one persisted
    // record per project is the natural ceiling.
    .limit(projectIds.length);
}

export async function findByProjectIdTx(
  tx: Writer, tenantId: string, projectId: string,
): Promise<EscalationRow | null> {
  const rows = await tx.select().from(projectEscalations)
    .where(and(
      eq(projectEscalations.tenantId, tenantId),
      eq(projectEscalations.projectId, projectId),
    ))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Idempotently create the action-state row for a project's escalation (its
 * first action). Duplicate (tenant_id, project_id) is a no-op — a concurrent
 * first-action loses and the caller re-reads. Returns true when inserted.
 */
export async function insertIdempotent(tx: Writer, row: EscalationInsert): Promise<boolean> {
  const inserted = await tx.insert(projectEscalations)
    .values(row)
    .onConflictDoNothing({
      target: [projectEscalations.tenantId, projectEscalations.projectId],
    })
    .returning({ id: projectEscalations.id });
  return inserted.length > 0;
}

/**
 * Move an escalation to a new status / assignee, guarded by the required source
 * status AND an optimistic version check. Returns rows updated (0 ⇒ the record
 * moved out of `fromStatus` or the version changed). `patch` carries the
 * action-specific columns (acknowledgedBy/At, clearedBy/At, escalatedTo, note).
 */
export async function transitionTx(
  tx: Writer,
  tenantId: string,
  projectId: string,
  fromStatus: string,
  toStatus: string,
  actorId: string,
  expectedVersion: number,
  patch: Partial<Pick<EscalationRow,
    "acknowledgedBy" | "acknowledgedAt" | "clearedBy" | "clearedAt" | "escalatedTo" | "note">>,
): Promise<number> {
  const res = await tx.update(projectEscalations)
    .set({
      status: toStatus,
      updatedBy: actorId,
      version: sql`${projectEscalations.version} + 1`,
      updatedAt: new Date(),
      ...patch,
    })
    .where(and(
      eq(projectEscalations.tenantId, tenantId),
      eq(projectEscalations.projectId, projectId),
      eq(projectEscalations.status, fromStatus),
      eq(projectEscalations.version, expectedVersion),
    ));
  return (res as { rowCount?: number }).rowCount ?? 0;
}
