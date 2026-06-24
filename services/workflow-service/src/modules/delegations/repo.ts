import { and, eq, sql, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { delegations, type DelegationRow, type DelegationView } from "./schema.js";

export function toView(r: DelegationRow): DelegationView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    delegatorId: r.delegatorId,
    delegateId: r.delegateId,
    fromDate: r.fromDate,
    toDate: r.toDate ?? null,
    reason: r.reason ?? null,
    isActive: r.isActive,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

export async function create(input: {
  tenantId: string;
  delegatorId: string;
  delegateId: string;
  fromDate: string;
  toDate: string | null;
  reason: string | null;
}): Promise<DelegationView> {
  const rows = await db.insert(delegations).values({
    tenantId: input.tenantId,
    delegatorId: input.delegatorId,
    delegateId: input.delegateId,
    fromDate: input.fromDate,
    toDate: input.toDate,
    reason: input.reason,
    isActive: true,
  }).returning();
  return toView(rows[0]!);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<{ rows: DelegationView[]; total: number }> {
  const rows = await db.select().from(delegations)
    .where(eq(delegations.tenantId, tenantId))
    .orderBy(desc(delegations.createdAt))
    .limit(limit)
    .offset(offset);
  const totalRes = await db.select({ n: sql<number>`count(*)::int` }).from(delegations)
    .where(eq(delegations.tenantId, tenantId));
  return { rows: rows.map(toView), total: totalRes[0]?.n ?? 0 };
}

export async function findById(id: string, tenantId: string): Promise<DelegationView | null> {
  const rows = await db.select().from(delegations)
    .where(and(eq(delegations.id, id), eq(delegations.tenantId, tenantId)))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

/** Soft-delete: revoke a delegation (is_active = false). Returns the updated view or null. */
export async function revoke(id: string, tenantId: string): Promise<DelegationView | null> {
  const rows = await db.update(delegations)
    .set({ isActive: false })
    .where(and(eq(delegations.id, id), eq(delegations.tenantId, tenantId)))
    .returning();
  return rows[0] ? toView(rows[0]) : null;
}

/**
 * L3 — active delegations naming `delegateId` as delegate, valid for `onDate`
 * (YYYY-MM-DD). An active delegation lets the delegate act on behalf of the
 * delegator's role. Date bounds are inclusive; a null to_date is open-ended.
 */
export async function activeForDelegate(
  tenantId: string,
  delegateId: string,
  onDate: string,
): Promise<DelegationView[]> {
  const rows = await db.select().from(delegations)
    .where(and(
      eq(delegations.tenantId, tenantId),
      eq(delegations.delegateId, delegateId),
      eq(delegations.isActive, true),
      sql`${delegations.fromDate} <= ${onDate}`,
      sql`(${delegations.toDate} IS NULL OR ${delegations.toDate} >= ${onDate})`,
    ));
  return rows.map(toView);
}
