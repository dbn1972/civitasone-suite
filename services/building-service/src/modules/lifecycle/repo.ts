import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { buildingCertificates, buildingRenewals, type BuildingCertificateRow, type BuildingCertificateInsert, type BuildingRenewalRow, type BuildingRenewalInsert } from "./schema.js";

export async function findCertificateById(id: string, tenantId: string): Promise<BuildingCertificateRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(buildingCertificates).where(and(eq(buildingCertificates.id, id), eq(buildingCertificates.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function listCertificatesByPermit(permitId: string, tenantId: string): Promise<BuildingCertificateRow[]> {
  return scopedRead((tx) =>
    tx.select().from(buildingCertificates).where(and(eq(buildingCertificates.tenantId, tenantId), eq(buildingCertificates.permitId, permitId))).orderBy(desc(buildingCertificates.createdAt)),
  );
}

export async function insertCertificate(tx: ScopedTx, row: BuildingCertificateInsert): Promise<void> {
  await tx.insert(buildingCertificates).values(row);
}

export async function findRenewalById(id: string, tenantId: string): Promise<BuildingRenewalRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(buildingRenewals).where(and(eq(buildingRenewals.id, id), eq(buildingRenewals.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function listRenewalsByPermit(permitId: string, tenantId: string): Promise<BuildingRenewalRow[]> {
  return scopedRead((tx) =>
    tx.select().from(buildingRenewals).where(and(eq(buildingRenewals.tenantId, tenantId), eq(buildingRenewals.permitId, permitId))).orderBy(desc(buildingRenewals.createdAt)),
  );
}

export async function listRenewals(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: BuildingRenewalRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const conditions = [eq(buildingRenewals.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(buildingRenewals.status, opts.status));
  const rows = await scopedRead((tx) =>
    tx.select().from(buildingRenewals).where(and(...conditions)).orderBy(desc(buildingRenewals.createdAt)).limit(pageSize).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(buildingRenewals).where(and(...conditions)),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertRenewal(tx: ScopedTx, row: BuildingRenewalInsert): Promise<void> {
  await tx.insert(buildingRenewals).values(row);
}

export async function updateRenewalDecision(
  tx: ScopedTx, id: string, tenantId: string, status: string,
  decidedBy: string, reason: string | null, newValidUntil: Date | null,
): Promise<boolean> {
  const result = await tx.update(buildingRenewals)
    .set({ status, decidedBy, decidedAt: new Date(), decisionReason: reason, newValidUntil, updatedBy: decidedBy, updatedAt: new Date(), version: sql`${buildingRenewals.version} + 1` })
    .where(and(eq(buildingRenewals.id, id), eq(buildingRenewals.tenantId, tenantId)))
    .returning({ id: buildingRenewals.id });
  return result.length > 0;
}
