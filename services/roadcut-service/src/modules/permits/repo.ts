import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { roadcutPermits, type RoadcutPermitRow, type RoadcutPermitInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<RoadcutPermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(roadcutPermits)
      .where(and(eq(roadcutPermits.id, id), eq(roadcutPermits.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findByApplication(applicationId: string, tenantId: string): Promise<RoadcutPermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(roadcutPermits)
      .where(and(eq(roadcutPermits.applicationId, applicationId), eq(roadcutPermits.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: RoadcutPermitRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(roadcutPermits.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(roadcutPermits.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(roadcutPermits)
      .where(and(...conditions))
      .orderBy(desc(roadcutPermits.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(roadcutPermits)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertPermit(tx: ScopedTx, row: RoadcutPermitInsert): Promise<void> {
  await tx.insert(roadcutPermits).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(roadcutPermits)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${roadcutPermits.version} + 1`,
    })
    .where(and(eq(roadcutPermits.id, id), eq(roadcutPermits.tenantId, tenantId)))
    .returning({ id: roadcutPermits.id });
  return result.length > 0;
}

export async function extendPermit(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  extendedUntil: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(roadcutPermits)
    .set({
      status: "extended",
      extendedUntil,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${roadcutPermits.version} + 1`,
    })
    .where(and(eq(roadcutPermits.id, id), eq(roadcutPermits.tenantId, tenantId)))
    .returning({ id: roadcutPermits.id });
  return result.length > 0;
}
