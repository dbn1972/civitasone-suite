import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { marketLifecycleRequests, type LifecycleRequestRow, type LifecycleRequestInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<LifecycleRequestRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(marketLifecycleRequests)
      .where(and(eq(marketLifecycleRequests.id, id), eq(marketLifecycleRequests.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByAllotment(
  allotmentId: string,
  tenantId: string,
  opts: { page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: LifecycleRequestRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [
    eq(marketLifecycleRequests.tenantId, tenantId),
    eq(marketLifecycleRequests.allotmentId, allotmentId),
  ];

  const rows = await scopedRead((tx) =>
    tx.select().from(marketLifecycleRequests)
      .where(and(...conditions))
      .orderBy(desc(marketLifecycleRequests.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(marketLifecycleRequests)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertRequest(tx: ScopedTx, row: LifecycleRequestInsert): Promise<void> {
  await tx.insert(marketLifecycleRequests).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  fromStatuses: readonly string[],
  updatedBy: string,
  extra?: { approvedBy?: string; completedAt?: Date },
): Promise<LifecycleRequestRow | null> {
  const result = await tx.update(marketLifecycleRequests)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      ...(extra?.approvedBy ? { approvedBy: extra.approvedBy } : {}),
      ...(extra?.completedAt ? { completedAt: extra.completedAt } : {}),
      version: sql`${marketLifecycleRequests.version} + 1`,
    })
    .where(and(
      eq(marketLifecycleRequests.id, id),
      eq(marketLifecycleRequests.tenantId, tenantId),
      inArray(marketLifecycleRequests.status, fromStatuses as string[]),
    ))
    .returning();
  return result[0] ?? null;
}
