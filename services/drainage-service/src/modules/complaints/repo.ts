import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { drainageComplaints, type ComplaintRow, type ComplaintInsert } from "./schema.js";

export function toView(r: ComplaintRow) {
  return {
    id: r.id, tenantId: r.tenantId, complaintNumber: r.complaintNumber, reportedBy: r.reportedBy,
    location: r.location, complaintType: r.complaintType, description: r.description, photo: r.photo,
    severity: r.severity, status: r.status, assignedTo: r.assignedTo,
    assignedAt: r.assignedAt?.toISOString() ?? null, resolvedAt: r.resolvedAt?.toISOString() ?? null,
    resolution: r.resolution,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<ComplaintRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(drainageComplaints).where(and(eq(drainageComplaints.id, id), eq(drainageComplaints.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

// Same lookup as findById, but runs inside a caller-supplied transaction rather
// than opening its own via scopedRead. Needed so the field-action consumer can
// read this complaint's current status/version and then CAS-update it (see
// field_actions/consumer.ts) atomically within one transaction, instead of
// racing a separate read against its own write.
export async function findByIdTx(tx: ScopedTx, id: string, tenantId: string): Promise<ComplaintRow | null> {
  const rows = await tx
    .select()
    .from(drainageComplaints)
    .where(and(eq(drainageComplaints.id, id), eq(drainageComplaints.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number, filters: { status?: string | undefined; severity?: string | undefined } = {}) {
  const conditions = [eq(drainageComplaints.tenantId, tenantId)];
  if (filters.status) conditions.push(eq(drainageComplaints.status, filters.status));
  if (filters.severity) conditions.push(eq(drainageComplaints.severity, filters.severity));
  const where = and(...conditions);
  const rows = await scopedRead((tx) =>
    tx.select().from(drainageComplaints).where(where).orderBy(desc(drainageComplaints.createdAt)).limit(limit).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(drainageComplaints).where(where),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: ComplaintInsert): Promise<void> {
  await tx.insert(drainageComplaints).values(row);
}

export async function update(tx: ScopedTx, id: string, tenantId: string, patch: Partial<ComplaintInsert>, currentVersion: number): Promise<boolean> {
  const result = await tx
    .update(drainageComplaints)
    .set({ ...patch, updatedAt: new Date(), version: sql`${drainageComplaints.version} + 1` })
    .where(and(eq(drainageComplaints.id, id), eq(drainageComplaints.tenantId, tenantId), eq(drainageComplaints.version, currentVersion)))
    .returning({ id: drainageComplaints.id });
  return result.length > 0;
}
