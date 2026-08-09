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
    .set({ status, updatedBy, updatedAt: new Date(), submittedAt: status === "submitted" ? new Date() : undefined, version: sql`${buildingApplications.version} + 1` })
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
