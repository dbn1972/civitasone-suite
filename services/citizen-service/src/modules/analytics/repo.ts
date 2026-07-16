import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { citizenSlaConfigs, citizenDeliveryMetrics } from "./schema.js";
import type { SlaConfigRow, DeliveryMetricRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findSlaConfig(tenantId: string, serviceType: string): Promise<SlaConfigRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(citizenSlaConfigs)
    .where(and(eq(citizenSlaConfigs.tenantId, tenantId), eq(citizenSlaConfigs.serviceType, serviceType)))
    .limit(1));
  return rows[0] ?? null;
}

export async function listDeliveryMetrics(tenantId: string): Promise<DeliveryMetricRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(citizenDeliveryMetrics).where(eq(citizenDeliveryMetrics.tenantId, tenantId)));
}

export async function aggregateGrievancesByDepartment(tenantId: string): Promise<{ departmentRef: string | null; pending: number; resolved: number }[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(citizenDeliveryMetrics)
    .where(and(eq(citizenDeliveryMetrics.tenantId, tenantId), eq(citizenDeliveryMetrics.serviceType, "grievance"))));
  return rows.map((r) => ({
    departmentRef: r.departmentRef ?? null,
    pending: r.pendingCount,
    resolved: r.resolvedCount,
  }));
}
