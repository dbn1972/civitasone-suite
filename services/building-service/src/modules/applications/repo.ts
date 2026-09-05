import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { buildingApplications, type BuildingApplicationRow, type BuildingApplicationInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<BuildingApplicationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(buildingApplications)
      .where(and(eq(buildingApplications.id, id), eq(buildingApplications.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/**
 * Same lookup as `findById`, but reads through an ALREADY-OPEN transaction
 * instead of opening a second one via `scopedRead`.
 *
 * `applications/consumer.ts`'s `submitApplication`, `permits/consumer.ts`'s
 * `issuePermit`, and `scrutiny/consumer.ts`'s `decideApplication` all used to
 * call `findById` (which calls `scopedRead`, i.e. `db.transaction`) from
 * inside their own already-open outer `db.transaction(async (tx) => {...})`
 * block. That opens a SECOND connection from the same pool as the outer
 * transaction — with `pool.max = 10`, enough concurrent calls exhaust the
 * pool and every one of them deadlocks waiting for a connection its own
 * nested lookup will never get. Same shape as notification-service's
 * checkQuota/checkDlt deadlock (PR #1028) — this variant reuses the caller's
 * `tx` (which already carries the RLS `app.tenant_id` GUC set once for the
 * whole outer transaction) so no second connection is ever acquired.
 */
export async function findByIdInTx(tx: ScopedTx, id: string, tenantId: string): Promise<BuildingApplicationRow | null> {
  const rows = await tx.select().from(buildingApplications)
    .where(and(eq(buildingApplications.id, id), eq(buildingApplications.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findByNumber(applicationNumber: string, tenantId: string): Promise<BuildingApplicationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(buildingApplications)
      .where(and(eq(buildingApplications.applicationNumber, applicationNumber), eq(buildingApplications.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: BuildingApplicationRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const conditions = [eq(buildingApplications.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(buildingApplications.status, opts.status));
  const rows = await scopedRead((tx) =>
    tx.select().from(buildingApplications).where(and(...conditions)).orderBy(desc(buildingApplications.createdAt)).limit(pageSize).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(buildingApplications).where(and(...conditions)),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertApplication(tx: ScopedTx, row: BuildingApplicationInsert): Promise<void> {
  await tx.insert(buildingApplications).values(row);
}

export async function updateStatus(
  tx: ScopedTx, id: string, tenantId: string, status: string, updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(buildingApplications)
    .set({ status, updatedBy, updatedAt: new Date(), ...(status === "submitted" ? { submittedAt: new Date() } : {}), version: sql`${buildingApplications.version} + 1` })
    .where(and(eq(buildingApplications.id, id), eq(buildingApplications.tenantId, tenantId)))
    .returning({ id: buildingApplications.id });
  return result.length > 0;
}

export async function updateFeePayment(
  tx: ScopedTx, id: string, tenantId: string, transactionId: string, updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(buildingApplications)
    .set({ feePaid: true, feeTransactionId: transactionId, updatedBy, updatedAt: new Date(), version: sql`${buildingApplications.version} + 1` })
    .where(and(eq(buildingApplications.id, id), eq(buildingApplications.tenantId, tenantId)))
    .returning({ id: buildingApplications.id });
  return result.length > 0;
}
