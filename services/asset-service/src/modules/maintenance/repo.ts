import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
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
  const rows = await db.select().from(assetWorkOrders).where(and(eq(assetWorkOrders.id, id), eq(assetWorkOrders.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function completeWorkOrder(tx: Writer, id: string, tenantId: string, completedDate: string, costMinor: bigint, actorId: string): Promise<void> {
  await (tx as typeof db).update(assetWorkOrders)
    .set({ status: "completed", completedDate, costMinor, updatedAt: new Date(), updatedBy: actorId })
    .where(and(eq(assetWorkOrders.id, id), eq(assetWorkOrders.tenantId, tenantId)));
}

export async function listMaintenanceByAsset(tenantId: string, assetId: string, limit = 500) {
  return db.select().from(assetWorkOrders)
    .where(and(eq(assetWorkOrders.tenantId, tenantId), eq(assetWorkOrders.assetId, assetId)))
    .limit(limit);
}

export async function listMaintenanceByTenant(tenantId: string, opts?: { limit?: number; offset?: number }) {
  return db.select().from(assetWorkOrders)
    .where(eq(assetWorkOrders.tenantId, tenantId))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);
}
