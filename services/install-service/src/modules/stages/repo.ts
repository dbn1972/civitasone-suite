import { and, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { stages, type StageRow, type StageInsert, type StageView } from "./schema.js";

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
    .limit(1);
  return rows[0] ?? null;
}

export async function updateLifecycle(
  tx: Writer,
  id: string,
  tenantId: string,
  actorId: string,
  version: number,
  patch: Partial<Pick<StageInsert, "status" | "startedAt" | "completedAt" | "errorMessage">>,
): Promise<void> {
  await tx
    .update(stages)
    .set({ ...patch, updatedAt: new Date(), updatedBy: actorId, version: version + 1 })
    .where(and(eq(stages.id, id), eq(stages.tenantId, tenantId)));
}

export { toView };
