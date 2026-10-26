import { and, desc, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import {
  stages, domainPackActivations,
  type StageRow, type StageInsert, type StageView,
  type DomainPackActivationRow, type DomainPackActivationInsert, type DomainPackActivationView,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * TENANT-SCOPING FIX (deep-verification, 2026-08-27): install.stages has
 * FORCE ROW LEVEL SECURITY (migration 0003/0006), strictly
 * `tenant_id = install.current_tenant_id()`, no escape hatch. The app's
 * `wrapWithTenantGuc` (packages/db/src/wrap-tenant-db.ts) only injects the
 * app.tenant_id GUC around db.transaction() calls -- a bare db.select() never
 * gets it, so every read here returned zero rows regardless of tenant
 * context. Same root cause and same fix pattern as
 * services/install-service/src/modules/orchestrator/repo.ts (PR #792) and
 * services/tenant-service/src/modules/tenant/repo.ts (PR #809).
 */
async function tenantScoped<T>(tenantId: string, fn: (tx: Writer) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction((tx) => fn(tx as unknown as Writer)));
}

function toView(r: StageRow): StageView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    stepNumber: r.stepNumber,
    description: r.description,
    status: r.status,
    isRequired: r.isRequired,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    errorMessage: r.errorMessage,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<StageView | null> {
  const rows = await tenantScoped(tenantId, (tx) =>
    (tx as unknown as typeof db).select().from(stages).where(eq(stages.id, id)).limit(1),
  );
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<StageView[]> {
  const rows = await tenantScoped(tenantId, (tx) =>
    (tx as unknown as typeof db).select().from(stages).where(eq(stages.tenantId, tenantId)).limit(limit).offset(offset),
  );
  return rows.map(toView);
}

export async function insert(tx: Writer, row: StageInsert): Promise<void> {
  await tx.insert(stages).values(row);
}

/** Tenant-scoped raw row on the caller's open transaction (consumer path). */
export async function findRowTx(tx: Writer, id: string, tenantId: string): Promise<StageRow | null> {
  const rows = await (tx as unknown as typeof db)
    .select()
    .from(stages)
    .where(and(eq(stages.id, id), eq(stages.tenantId, tenantId)))
    .limit(1)
    // Row lock: serialises concurrent transitions (Run vs Skip) so the status we validate is the
    // status we write over. The loser blocks until the winner commits, then re-reads the new status.
    .for("update");
  return rows[0] ?? null;
}

export async function updateLifecycle(
  tx: Writer,
  id: string,
  tenantId: string,
  actorId: string,
  version: number,
  patch: Partial<Pick<StageInsert, "status" | "startedAt" | "completedAt" | "errorMessage">>,
): Promise<number> {
  const updated = await tx
    .update(stages)
    .set({ ...patch, updatedAt: new Date(), updatedBy: actorId, version: version + 1 })
    // Optimistic guard on top of the row lock: never overwrite a row whose version moved.
    .where(and(eq(stages.id, id), eq(stages.tenantId, tenantId), eq(stages.version, version)))
    .returning({ id: stages.id });
  return updated.length;
}

function toActivationView(r: DomainPackActivationRow): DomainPackActivationView {
  return {
    id: r.id,
    domainPackKey: r.domainPackKey,
    packKeys: r.packKeys,
    stageId: r.stageId,
    status: r.status as DomainPackActivationView["status"],
    draftIds: r.draftIds,
    failureReason: r.failureReason,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Newest activation of a pack for the tenant (null when it has never been activated). */
export async function findLatestActivation(tenantId: string, domainPackKey: string): Promise<DomainPackActivationView | null> {
  const rows = await tenantScoped(tenantId, (tx) =>
    (tx as unknown as typeof db)
      .select()
      .from(domainPackActivations)
      .where(and(eq(domainPackActivations.tenantId, tenantId), eq(domainPackActivations.domainPackKey, domainPackKey)))
      .orderBy(desc(domainPackActivations.createdAt))
      .limit(1),
  );
  return rows[0] ? toActivationView(rows[0]) : null;
}

/** Idempotent: a redelivered record command (or a replay) never overwrites a row that moved on. */
export async function insertActivation(tx: Writer, row: DomainPackActivationInsert): Promise<void> {
  await tx.insert(domainPackActivations).values(row).onConflictDoNothing({ target: domainPackActivations.id });
}

/**
 * Terminal transition, guarded: only an `accepted` row of THIS tenant moves, so a stale, duplicate or
 * cross-tenant completion event can never rewrite a finished activation. Returns the row (for its stage id)
 * or null when nothing moved.
 */
export async function completeActivation(
  tx: Writer,
  tenantId: string,
  id: string,
  actorId: string,
  patch: { status: "completed" | "failed"; draftIds: string[]; failureReason: string | null },
): Promise<DomainPackActivationRow | null> {
  const now = new Date();
  const updated = await tx
    .update(domainPackActivations)
    .set({ ...patch, completedAt: now, updatedAt: now, updatedBy: actorId })
    .where(and(
      eq(domainPackActivations.id, id),
      eq(domainPackActivations.tenantId, tenantId),
      eq(domainPackActivations.status, "accepted"),
    ))
    .returning();
  return updated[0] ?? null;
}

export { toView };
