import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { refundRequests, type RefundRequestRow, type RefundRequestInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<RefundRequestRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(refundRequests)
      .where(and(eq(refundRequests.id, id), eq(refundRequests.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findByNumber(requestNumber: string, tenantId: string): Promise<RefundRequestRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(refundRequests)
      .where(and(eq(refundRequests.requestNumber, requestNumber), eq(refundRequests.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: RefundRequestRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(refundRequests.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(refundRequests.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(refundRequests)
      .where(and(...conditions))
      .orderBy(desc(refundRequests.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(refundRequests)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertRequest(tx: ScopedTx, row: RefundRequestInsert): Promise<void> {
  await tx.insert(refundRequests).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(refundRequests)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      submittedAt: status === "under_review" ? new Date() : undefined,
      version: sql`${refundRequests.version} + 1`,
    })
    .where(and(eq(refundRequests.id, id), eq(refundRequests.tenantId, tenantId)))
    .returning({ id: refundRequests.id });
  return result.length > 0;
}
