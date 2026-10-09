import { eq, and, type SQL } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabLeaseProperties, estabLeases, estabLeasePayments, estabLeaseRequests } from "./schema.js";

export interface ListPage<T> {
  data: T[];
  pagination: { hasMore: boolean; pageSize: number; cursor?: string };
}

// PERF-006: listProperties/listLeases/listRequests used to return the WHOLE
// tenant's rows with no limit/offset -- routes.ts's listQuery already parsed
// limit/offset (for a pagination UI that was apparently never wired up) but
// never passed them through here. See booking/queries.ts's paginate() for
// the same convention.
// Review follow-up: orderBy(id) on every limit/offset query below keeps the
// row partition stable across page fetches (offset pagination with no
// deterministic order has no guaranteed stable split across calls) --
// matches this same PR's hrms-service fixes (ai-fraud/routes.ts).
function paginate<T>(rows: T[], limit: number, offset: number): ListPage<T> {
  return {
    data: rows,
    pagination: {
      hasMore: rows.length === limit,
      pageSize: limit,
      ...(rows.length > 0 ? { cursor: String(offset + rows.length) } : {}),
    },
  };
}

export async function listProperties(
  tenantId: string,
  q: { status?: string | undefined },
  limit: number,
  offset: number,
): Promise<ListPage<unknown>> {
  // GAP2-ESTAB-BOOKING-ORPHAN-01: reads go through db.transaction() so the
  // per-tenant app.tenant_id GUC is set — these tables are FORCE RLS, so a
  // plain db.select() fails CLOSED (empty) for every tenant.
  const rows = q.status
    ? await db.transaction((tx) => tx.select().from(estabLeaseProperties)
        .where(and(eq(estabLeaseProperties.tenantId, tenantId), eq(estabLeaseProperties.status, q.status!)))
        .orderBy(estabLeaseProperties.id)
        .limit(limit).offset(offset))
    : await db.transaction((tx) => tx.select().from(estabLeaseProperties)
        .where(eq(estabLeaseProperties.tenantId, tenantId))
        .orderBy(estabLeaseProperties.id)
        .limit(limit).offset(offset));
  return paginate(rows, limit, offset);
}

export async function getProperty(tenantId: string, id: string): Promise<unknown | undefined> {
  const rows = await db.transaction((tx) => tx.select().from(estabLeaseProperties)
    .where(and(eq(estabLeaseProperties.tenantId, tenantId), eq(estabLeaseProperties.id, id)))
    .limit(1));
  return rows[0];
}

export async function listLeases(
  tenantId: string,
  q: { status?: string | undefined; ownerId?: string | undefined },
  limit: number,
  offset: number,
): Promise<ListPage<unknown>> {
  // IDOR: ownerId (set for citizen/employee callers) restricts to rows they created.
  const conds: SQL[] = [eq(estabLeases.tenantId, tenantId)];
  if (q.status) conds.push(eq(estabLeases.status, q.status));
  if (q.ownerId) conds.push(eq(estabLeases.createdBy, q.ownerId));
  const rows = await db.transaction((tx) => tx.select().from(estabLeases)
    .where(and(...conds))
    .orderBy(estabLeases.id)
    .limit(limit).offset(offset));
  return paginate(rows, limit, offset);
}

export async function getLease(tenantId: string, id: string, ownerId?: string): Promise<unknown | undefined> {
  const rows = await db.transaction((tx) => tx.select().from(estabLeases)
    .where(and(eq(estabLeases.tenantId, tenantId), eq(estabLeases.id, id), ...(ownerId ? [eq(estabLeases.createdBy, ownerId)] : [])))
    .limit(1));
  return rows[0];
}

export async function listLeasePayments(tenantId: string, leaseId: string): Promise<unknown[]> {
  // Scoped to one lease, not tenant-wide -- naturally bounded by a single
  // lease's payment history, so out of scope for PERF-006.
  return db.transaction((tx) => tx.select().from(estabLeasePayments)
    .where(and(eq(estabLeasePayments.tenantId, tenantId), eq(estabLeasePayments.leaseId, leaseId))));
}

export async function listRequests(
  tenantId: string,
  q: { status?: string | undefined; ownerId?: string | undefined },
  limit: number,
  offset: number,
): Promise<ListPage<unknown>> {
  // IDOR: ownerId (set for citizen/employee callers) restricts to rows they created.
  const conds: SQL[] = [eq(estabLeaseRequests.tenantId, tenantId)];
  if (q.status) conds.push(eq(estabLeaseRequests.status, q.status));
  if (q.ownerId) conds.push(eq(estabLeaseRequests.createdBy, q.ownerId));
  const rows = await db.transaction((tx) => tx.select().from(estabLeaseRequests)
    .where(and(...conds))
    .orderBy(estabLeaseRequests.id)
    .limit(limit).offset(offset));
  return paginate(rows, limit, offset);
}

export async function getRequest(tenantId: string, id: string, ownerId?: string): Promise<unknown | undefined> {
  const rows = await db.transaction((tx) => tx.select().from(estabLeaseRequests)
    .where(and(eq(estabLeaseRequests.tenantId, tenantId), eq(estabLeaseRequests.id, id), ...(ownerId ? [eq(estabLeaseRequests.createdBy, ownerId)] : [])))
    .limit(1));
  return rows[0];
}
