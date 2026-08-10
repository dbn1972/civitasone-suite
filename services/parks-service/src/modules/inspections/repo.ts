import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { parksInspections, type InspectionRow, type InspectionInsert } from "./schema.js";

export function toView(r: InspectionRow) {
  return {
    id: r.id, tenantId: r.tenantId, complaintId: r.complaintId,
    treeRequestId: r.treeRequestId, inspectorId: r.inspectorId,
    scheduledDate: r.scheduledDate, inspectedAt: r.inspectedAt?.toISOString() ?? null,
    findings: r.findings, photos: r.photos,
    workOrderRequired: r.workOrderRequired, status: r.status,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<InspectionRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(parksInspections).where(and(eq(parksInspections.id, id), eq(parksInspections.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number, status?: string) {
  const conditions = [eq(parksInspections.tenantId, tenantId)];
  if (status) conditions.push(eq(parksInspections.status, status));
  const where = and(...conditions);
  const rows = await scopedRead((tx) =>
    tx.select().from(parksInspections).where(where).orderBy(desc(parksInspections.createdAt)).limit(limit).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(parksInspections).where(where),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: InspectionInsert): Promise<void> {
  await tx.insert(parksInspections).values(row);
}

export async function update(tx: ScopedTx, id: string, tenantId: string, patch: Partial<InspectionInsert>, currentVersion: number): Promise<boolean> {
  const result = await tx
    .update(parksInspections)
    .set({ ...patch, updatedAt: new Date(), version: sql`${parksInspections.version} + 1` })
    .where(and(eq(parksInspections.id, id), eq(parksInspections.tenantId, tenantId), eq(parksInspections.version, currentVersion)))
    .returning({ id: parksInspections.id });
  return result.length > 0;
}
