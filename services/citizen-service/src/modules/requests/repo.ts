import { eq, and, gte, inArray, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  citizenRequests, citizenRequestStatusHistory,
  type CitizenRequestRow, type CitizenRequestInsert, type CitizenRequestHistoryInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertRequest(tx: Writer, row: CitizenRequestInsert): Promise<void> {
  await tx.insert(citizenRequests).values(row);
}

export async function insertStatusHistory(tx: Writer, row: CitizenRequestHistoryInsert): Promise<void> {
  await tx.insert(citizenRequestStatusHistory).values(row);
}

/** P1-2: scope by (id AND tenantId) so a forged foreign id cannot be read/mutated. */
export async function findRequestByIdTx(tx: Writer, id: string, tenantId: string): Promise<CitizenRequestRow | null> {
  const rows = await (tx as typeof db).select().from(citizenRequests)
    .where(and(eq(citizenRequests.id, id), eq(citizenRequests.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findRequestById(id: string, tenantId: string): Promise<CitizenRequestRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(citizenRequests)
    .where(and(eq(citizenRequests.id, id), eq(citizenRequests.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function listRequestsByTenant(
  tenantId: string,
  limit = 50,
  offset = 0,
  status?: string,
  citizenId?: string,
): Promise<CitizenRequestRow[]> {
  const conditions = [eq(citizenRequests.tenantId, tenantId)];
  // P0-3: a bare citizen is scoped to their own requests.
  if (citizenId) conditions.push(eq(citizenRequests.citizenId, citizenId));
  if (status) conditions.push(eq(citizenRequests.status, status));
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(citizenRequests)
    .where(and(...conditions))
    .orderBy(sql`${citizenRequests.createdAt} DESC`)
    .limit(limit).offset(offset));
}

export async function listStatusHistory(tenantId: string, requestId: string) {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(citizenRequestStatusHistory)
    .where(and(eq(citizenRequestStatusHistory.tenantId, tenantId), eq(citizenRequestStatusHistory.requestId, requestId)))
    .orderBy(citizenRequestStatusHistory.createdAt));
}

export async function updateRequest(tx: Writer, id: string, tenantId: string, patch: Partial<CitizenRequestInsert>): Promise<number> {
  // P1-2: tenant-scoped update prevents cross-tenant writes via a forged id.
  const updated = await (tx as typeof db).update(citizenRequests)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(citizenRequests.id, id), eq(citizenRequests.tenantId, tenantId)))
    .returning({ id: citizenRequests.id });
  return updated.length;
}

export async function countByStatuses(tenantId: string, statuses: string[]): Promise<number> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const [row] = await db.transaction((tx) => tx
    .select({ count: sql<number>`count(*)::int` })
    .from(citizenRequests)
    .where(and(eq(citizenRequests.tenantId, tenantId), inArray(citizenRequests.status, statuses))));
  return row?.count ?? 0;
}

export async function resolvedThisMonthStats(tenantId: string): Promise<{ count: number; avgResolutionDays: number }> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const [row] = await db.transaction((tx) => tx
    .select({
      count: sql<number>`count(*)::int`,
      avgDays: sql<number>`coalesce(avg(extract(epoch from (${citizenRequests.resolvedAt} - ${citizenRequests.createdAt})) / 86400.0), 0)`,
    })
    .from(citizenRequests)
    .where(and(
      eq(citizenRequests.tenantId, tenantId),
      eq(citizenRequests.status, "resolved"),
      gte(citizenRequests.resolvedAt, monthStart),
    )));
  return { count: row?.count ?? 0, avgResolutionDays: Number(row?.avgDays ?? 0) };
}
