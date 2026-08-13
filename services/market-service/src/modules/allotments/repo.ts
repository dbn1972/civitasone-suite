import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { marketAllotments, type AllotmentRow, type AllotmentInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<AllotmentRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(marketAllotments)
      .where(and(eq(marketAllotments.id, id), eq(marketAllotments.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; propertyId?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: AllotmentRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(marketAllotments.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(marketAllotments.status, opts.status));
  if (opts.propertyId) conditions.push(eq(marketAllotments.propertyId, opts.propertyId));

  const rows = await scopedRead((tx) =>
    tx.select().from(marketAllotments)
      .where(and(...conditions))
      .orderBy(desc(marketAllotments.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(marketAllotments)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertAllotment(tx: ScopedTx, row: AllotmentInsert): Promise<void> {
  await tx.insert(marketAllotments).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
  extra?: { allotmentDate?: string; agreementStartDate?: string; agreementEndDate?: string },
): Promise<boolean> {
  const result = await tx.update(marketAllotments)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      ...(extra?.allotmentDate ? { allotmentDate: extra.allotmentDate } : {}),
      ...(extra?.agreementStartDate ? { agreementStartDate: extra.agreementStartDate } : {}),
      ...(extra?.agreementEndDate ? { agreementEndDate: extra.agreementEndDate } : {}),
      version: sql`${marketAllotments.version} + 1`,
    })
    .where(and(eq(marketAllotments.id, id), eq(marketAllotments.tenantId, tenantId)))
    .returning({ id: marketAllotments.id });
  return result.length > 0;
}
