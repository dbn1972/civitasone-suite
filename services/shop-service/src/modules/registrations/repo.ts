import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { applications, type ApplicationRow, type ApplicationInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<ApplicationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(applications)
      .where(and(eq(applications.id, id), eq(applications.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findByNumber(applicationNumber: string, tenantId: string): Promise<ApplicationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(applications)
      .where(and(eq(applications.applicationNumber, applicationNumber), eq(applications.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: ApplicationRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(applications.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(applications.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(applications)
      .where(and(...conditions))
      .orderBy(desc(applications.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(applications)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertApplication(tx: ScopedTx, row: ApplicationInsert): Promise<void> {
  await tx.insert(applications).values(row);
}

/**
 * fromStatuses: the set of application statuses this write is valid from
 * (the same set the caller's canTransition/canDecide check already
 * validated against). Folding it into the WHERE clause makes the write an
 * atomic compare-and-swap, closing the residual race between the caller's
 * pre-fetch and this UPDATE.
 */
export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  fromStatuses: string[],
  status: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(applications)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      submittedAt: status === "submitted" ? new Date() : null,
      version: sql`${applications.version} + 1`,
    })
    .where(and(
      eq(applications.id, id),
      eq(applications.tenantId, tenantId),
      inArray(applications.status, fromStatuses),
    ))
    .returning({ id: applications.id });
  return result.length > 0;
}

export async function updateFeePayment(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  transactionId: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(applications)
    .set({
      feePaid: true,
      feeTransactionId: transactionId,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${applications.version} + 1`,
    })
    // feePaid = false in the WHERE clause makes this an atomic compare-and-swap:
    // two racing fee-payment commands for the same application can no longer
    // both apply — the second sees 0 affected rows instead of silently
    // overwriting the first payment's transaction id.
    .where(and(
      eq(applications.id, id),
      eq(applications.tenantId, tenantId),
      eq(applications.feePaid, false),
    ))
    .returning({ id: applications.id });
  return result.length > 0;
}
