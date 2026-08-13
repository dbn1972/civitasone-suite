import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { animalComplaints, type ComplaintRow, type ComplaintInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<ComplaintRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(animalComplaints)
      .where(and(eq(animalComplaints.id, id), eq(animalComplaints.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; severity?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: ComplaintRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(animalComplaints.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(animalComplaints.status, opts.status));
  if (opts.severity) conditions.push(eq(animalComplaints.severity, opts.severity));

  const rows = await scopedRead((tx) =>
    tx.select().from(animalComplaints)
      .where(and(...conditions))
      .orderBy(desc(animalComplaints.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(animalComplaints)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertComplaint(tx: ScopedTx, row: ComplaintInsert): Promise<void> {
  await tx.insert(animalComplaints).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
  extra?: { assignedTo?: string; assignedTeam?: string; resolvedAt?: Date; resolution?: string },
): Promise<boolean> {
  const result = await tx.update(animalComplaints)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      ...(extra?.assignedTo ? { assignedTo: extra.assignedTo } : {}),
      ...(extra?.assignedTeam ? { assignedTeam: extra.assignedTeam } : {}),
      ...(extra?.resolvedAt ? { resolvedAt: extra.resolvedAt } : {}),
      ...(extra?.resolution ? { resolution: extra.resolution } : {}),
      version: sql`${animalComplaints.version} + 1`,
    })
    .where(and(eq(animalComplaints.id, id), eq(animalComplaints.tenantId, tenantId)))
    .returning({ id: animalComplaints.id });
  return result.length > 0;
}
