import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { sewerageApplications, sewerageConnections, type ApplicationRow, type ApplicationInsert, type ConnectionInsert } from "./schema.js";

export function appToView(r: ApplicationRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    applicationNumber: r.applicationNumber,
    status: r.status,
    propertyRef: r.propertyRef,
    waterConnectionRef: r.waterConnectionRef,
    connectionClass: r.connectionClass,
    siteDetails: r.siteDetails,
    feeMinor: r.feeMinor,
    feePaid: r.feePaid,
    feasibilityReport: r.feasibilityReport,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export async function findAppById(id: string, tenantId: string): Promise<ApplicationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(sewerageApplications).where(and(eq(sewerageApplications.id, id), eq(sewerageApplications.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function listApps(tenantId: string, limit: number, offset: number, status?: string) {
  const conditions = [eq(sewerageApplications.tenantId, tenantId)];
  if (status) conditions.push(eq(sewerageApplications.status, status));
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(sewerageApplications).where(where).orderBy(desc(sewerageApplications.createdAt)).limit(limit).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(sewerageApplications).where(where),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertApp(tx: ScopedTx, row: ApplicationInsert): Promise<void> {
  await tx.insert(sewerageApplications).values(row);
}

export async function updateApp(tx: ScopedTx, id: string, tenantId: string, patch: Partial<ApplicationInsert>, currentVersion: number): Promise<boolean> {
  const result = await tx
    .update(sewerageApplications)
    .set({ ...patch, updatedAt: new Date(), version: sql`${sewerageApplications.version} + 1` })
    .where(and(eq(sewerageApplications.id, id), eq(sewerageApplications.tenantId, tenantId), eq(sewerageApplications.version, currentVersion)))
    .returning({ id: sewerageApplications.id });
  return result.length > 0;
}

export async function insertConnection(tx: ScopedTx, row: ConnectionInsert): Promise<void> {
  await tx.insert(sewerageConnections).values(row);
}
