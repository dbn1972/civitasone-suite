import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { marketDemands, type DemandRow, type DemandInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<DemandRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(marketDemands)
      .where(and(eq(marketDemands.id, id), eq(marketDemands.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByAllotment(
  allotmentId: string,
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: DemandRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [
    eq(marketDemands.tenantId, tenantId),
    eq(marketDemands.allotmentId, allotmentId),
  ];
  if (opts.status) conditions.push(eq(marketDemands.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(marketDemands)
      .where(and(...conditions))
      .orderBy(desc(marketDemands.demandMonth))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(marketDemands)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertDemand(tx: ScopedTx, row: DemandInsert): Promise<void> {
  await tx.insert(marketDemands).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
  extra?: { paidAt?: Date; paymentRef?: string },
): Promise<boolean> {
  const result = await tx.update(marketDemands)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      ...(extra?.paidAt ? { paidAt: extra.paidAt } : {}),
      ...(extra?.paymentRef ? { paymentRef: extra.paymentRef } : {}),
      version: sql`${marketDemands.version} + 1`,
    })
    .where(and(eq(marketDemands.id, id), eq(marketDemands.tenantId, tenantId)))
    .returning({ id: marketDemands.id });
  return result.length > 0;
}
