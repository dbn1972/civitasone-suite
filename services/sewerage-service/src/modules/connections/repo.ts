import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { sewerageApplications, sewerageConnections, type ApplicationRow, type ApplicationInsert, type ConnectionRow, type ConnectionInsert } from "./schema.js";

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

// Existence lookup for sewerage_connections, used by billing/routes.ts's
// pre-accept check (POST /v1/sewerage/bills must reject a connectionId that
// doesn't exist or isn't active, rather than letting the command reach the
// queue and only fail silently downstream — see billing/routes.ts).
export async function findConnectionById(id: string, tenantId: string): Promise<ConnectionRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(sewerageConnections).where(and(eq(sewerageConnections.id, id), eq(sewerageConnections.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function insertConnection(tx: ScopedTx, row: ConnectionInsert): Promise<void> {
  await tx.insert(sewerageConnections).values(row);
}

// Reserves the next application number from the DB sequence (migrations/
// 0003_number_sequences.sql), inside the same transaction as the insert —
// guaranteed unique by Postgres itself, independent of wall-clock time or
// process concurrency. Replaces the old `SEW-${Date.now()}` scheme.
export async function nextApplicationNumber(tx: ScopedTx): Promise<number> {
  const [row] = (await tx.execute(
    sql`SELECT nextval('"civitas_sewerage"."application_number_seq"')::bigint AS seq`,
  )) as unknown as Array<{ seq: number }>;
  return Number(row!.seq);
}

// Same as nextApplicationNumber, for sewerage_connections.connection_number —
// replaces the old `SEWC-${Date.now()}` scheme.
export async function nextConnectionNumber(tx: ScopedTx): Promise<number> {
  const [row] = (await tx.execute(
    sql`SELECT nextval('"civitas_sewerage"."connection_number_seq"')::bigint AS seq`,
  )) as unknown as Array<{ seq: number }>;
  return Number(row!.seq);
}
