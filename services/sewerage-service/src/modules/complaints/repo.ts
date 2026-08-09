import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { sewerageComplaints, sewerageFieldRecords, type ComplaintRow, type ComplaintInsert, type FieldRecordInsert } from "./schema.js";

export function toView(r: ComplaintRow) {
  return {
    id: r.id, tenantId: r.tenantId, complaintNumber: r.complaintNumber, reportedBy: r.reportedBy,
    location: r.location, complaintType: r.complaintType, description: r.description, photo: r.photo,
    severity: r.severity, status: r.status, assignedTo: r.assignedTo, resolution: r.resolution,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<ComplaintRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(sewerageComplaints).where(and(eq(sewerageComplaints.id, id), eq(sewerageComplaints.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number, status?: string) {
  const conditions = [eq(sewerageComplaints.tenantId, tenantId)];
  if (status) conditions.push(eq(sewerageComplaints.status, status));
  const where = and(...conditions);
  const rows = await scopedRead((tx) =>
    tx.select().from(sewerageComplaints).where(where).orderBy(desc(sewerageComplaints.createdAt)).limit(limit).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(sewerageComplaints).where(where),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: ComplaintInsert): Promise<void> {
  await tx.insert(sewerageComplaints).values(row);
}

export async function update(tx: ScopedTx, id: string, tenantId: string, patch: Partial<ComplaintInsert>, currentVersion: number): Promise<boolean> {
  const result = await tx
    .update(sewerageComplaints)
    .set({ ...patch, updatedAt: new Date(), version: sql`${sewerageComplaints.version} + 1` })
    .where(and(eq(sewerageComplaints.id, id), eq(sewerageComplaints.tenantId, tenantId), eq(sewerageComplaints.version, currentVersion)))
    .returning({ id: sewerageComplaints.id });
  return result.length > 0;
}

export async function insertFieldRecord(tx: ScopedTx, row: FieldRecordInsert): Promise<void> {
  await tx.insert(sewerageFieldRecords).values(row);
}
