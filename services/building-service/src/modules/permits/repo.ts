import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { buildingPermits, type BuildingPermitRow, type BuildingPermitInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<BuildingPermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(buildingPermits).where(and(eq(buildingPermits.id, id), eq(buildingPermits.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function findByVerificationCode(code: string): Promise<BuildingPermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(buildingPermits).where(eq(buildingPermits.verificationCode, code)).limit(1),
  );
  return rows[0] ?? null;
}

export async function findByApplicationId(applicationId: string, tenantId: string): Promise<BuildingPermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(buildingPermits).where(and(eq(buildingPermits.applicationId, applicationId), eq(buildingPermits.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: BuildingPermitRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const conditions = [eq(buildingPermits.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(buildingPermits.status, opts.status));
  const rows = await scopedRead((tx) =>
    tx.select().from(buildingPermits).where(and(...conditions)).orderBy(desc(buildingPermits.issuedAt)).limit(pageSize).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(buildingPermits).where(and(...conditions)),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertPermit(tx: ScopedTx, row: BuildingPermitInsert): Promise<void> {
  await tx.insert(buildingPermits).values(row);
}

export async function updatePermitStatus(
  tx: ScopedTx, id: string, tenantId: string, status: string,
  fields: Partial<Pick<BuildingPermitRow, "suspendedAt" | "suspensionReason" | "cancelledAt" | "cancellationReason">>,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(buildingPermits)
    .set({ status, ...fields, updatedBy, updatedAt: new Date(), version: sql`${buildingPermits.version} + 1` })
    .where(and(eq(buildingPermits.id, id), eq(buildingPermits.tenantId, tenantId)))
    .returning({ id: buildingPermits.id });
  return result.length > 0;
}

export async function updateValidUntil(
  tx: ScopedTx, id: string, tenantId: string, validUntil: Date, updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(buildingPermits)
    .set({ validUntil, updatedBy, updatedAt: new Date(), version: sql`${buildingPermits.version} + 1` })
    .where(and(eq(buildingPermits.id, id), eq(buildingPermits.tenantId, tenantId)))
    .returning({ id: buildingPermits.id });
  return result.length > 0;
}
