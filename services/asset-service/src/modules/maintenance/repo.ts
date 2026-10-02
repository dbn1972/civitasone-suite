import { eq, and, desc } from "drizzle-orm";
import { assetAssets } from "../register/schema.js";
import { db, scopedRead } from "../../shared/db.js";
import {
  assetMaintenancePlans, assetWorkOrders,
  type MaintenancePlanInsert, type WorkOrderInsert, type WorkOrderRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertMaintenancePlan(tx: Writer, row: MaintenancePlanInsert): Promise<void> {
  await tx.insert(assetMaintenancePlans).values(row);
}

export async function insertWorkOrder(tx: Writer, row: WorkOrderInsert): Promise<void> {
  await tx.insert(assetWorkOrders).values(row);
}

export async function findWorkOrderById(id: string, tenantId: string): Promise<WorkOrderRow | null> {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const rows = await scopedRead((tx) => tx.select().from(assetWorkOrders).where(and(eq(assetWorkOrders.id, id), eq(assetWorkOrders.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

/**
 * Tx-scoped variant of findWorkOrderById -- see findAssetByIdTx in
 * register/repo.ts for the full rationale (section 1 of the
 * production-readiness-audit skill).
 */
export async function findWorkOrderByIdTx(tx: Writer, id: string, tenantId: string): Promise<WorkOrderRow | null> {
  const rows = await tx.select().from(assetWorkOrders).where(and(eq(assetWorkOrders.id, id), eq(assetWorkOrders.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function completeWorkOrder(tx: Writer, id: string, tenantId: string, completedDate: string, costMinor: bigint, actorId: string): Promise<void> {
  await (tx as typeof db).update(assetWorkOrders)
    .set({ status: "completed", completedDate, costMinor, updatedAt: new Date(), updatedBy: actorId })
    .where(and(eq(assetWorkOrders.id, id), eq(assetWorkOrders.tenantId, tenantId)));
}

// GAP-ASSETS-MAINTENANCE-02/-04: the queue (GET /maintenance) and the per-asset
// history (GET /assets/:id/maintenance) read the SAME table and return the SAME
// shape — the work-order row plus the asset's code/name (left join, tenant-matched)
// so the UI shows a real asset code instead of a truncated UUID.
const workOrderWithAsset = {
  wo: assetWorkOrders,
  assetCode: assetAssets.code,
  assetName: assetAssets.name,
};

export function withAssetLabel(r: { wo: WorkOrderRow; assetCode: string | null; assetName: string | null }) {
  return { ...r.wo, assetCode: r.assetCode, assetName: r.assetName };
}

export async function listMaintenanceByAsset(tenantId: string, assetId: string, limit = 500) {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const rows = await scopedRead((tx) => tx.select(workOrderWithAsset).from(assetWorkOrders)
    .leftJoin(assetAssets, and(eq(assetAssets.id, assetWorkOrders.assetId), eq(assetAssets.tenantId, assetWorkOrders.tenantId)))
    .where(and(eq(assetWorkOrders.tenantId, tenantId), eq(assetWorkOrders.assetId, assetId)))
    .limit(limit));
  return rows.map(withAssetLabel);
}

export async function listMaintenanceByTenant(tenantId: string, opts?: { limit?: number; offset?: number }) {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const rows = await scopedRead((tx) => tx.select(workOrderWithAsset).from(assetWorkOrders)
    .leftJoin(assetAssets, and(eq(assetAssets.id, assetWorkOrders.assetId), eq(assetAssets.tenantId, assetWorkOrders.tenantId)))
    .where(eq(assetWorkOrders.tenantId, tenantId))
    .orderBy(desc(assetWorkOrders.scheduledDate), desc(assetWorkOrders.id))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0));
  return rows.map(withAssetLabel);
}

export async function listMaintenancePlans(tenantId: string, opts?: { assetId?: string }) {
  const conditions: ReturnType<typeof eq>[] = [eq(assetMaintenancePlans.tenantId, tenantId)];
  if (opts?.assetId) conditions.push(eq(assetMaintenancePlans.assetId, opts.assetId));
  return scopedRead((tx) => tx.select().from(assetMaintenancePlans).where(and(...conditions)));
}
