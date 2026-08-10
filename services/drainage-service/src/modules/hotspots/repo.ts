import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { drainageHotspots, type HotspotRow, type HotspotInsert } from "./schema.js";

export function toView(r: HotspotRow) {
  return {
    id: r.id, tenantId: r.tenantId, hotspotCode: r.hotspotCode,
    location: r.location, category: r.category,
    complaintCount: r.complaintCount, lastComplaintAt: r.lastComplaintAt?.toISOString() ?? null,
    riskScore: r.riskScore, status: r.status, maintenancePlanRef: r.maintenancePlanRef,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<HotspotRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(drainageHotspots).where(and(eq(drainageHotspots.id, id), eq(drainageHotspots.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number, status?: string) {
  const conditions = [eq(drainageHotspots.tenantId, tenantId)];
  if (status) conditions.push(eq(drainageHotspots.status, status));
  const where = and(...conditions);
  const rows = await scopedRead((tx) =>
    tx.select().from(drainageHotspots).where(where).orderBy(desc(drainageHotspots.riskScore)).limit(limit).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(drainageHotspots).where(where),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: HotspotInsert): Promise<void> {
  await tx.insert(drainageHotspots).values(row);
}

export async function update(tx: ScopedTx, id: string, tenantId: string, patch: Partial<HotspotInsert>, currentVersion: number): Promise<boolean> {
  const result = await tx
    .update(drainageHotspots)
    .set({ ...patch, updatedAt: new Date(), version: sql`${drainageHotspots.version} + 1` })
    .where(and(eq(drainageHotspots.id, id), eq(drainageHotspots.tenantId, tenantId), eq(drainageHotspots.version, currentVersion)))
    .returning({ id: drainageHotspots.id });
  return result.length > 0;
}
