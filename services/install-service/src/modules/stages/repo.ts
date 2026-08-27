import { eq } from "drizzle-orm";
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

export { toView };
