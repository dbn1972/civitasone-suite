import { eq, and, desc, asc, lt, isNull, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { cases, caseParties, caseStateTransitions } from "./schema.js";

/** Narrow write surface accepted for the transactional (GUC-scoped) path. */
export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export type CaseRow                  = typeof cases.$inferSelect;
export type CaseInsert               = typeof cases.$inferInsert;
export type CasePartyRow             = typeof caseParties.$inferSelect;
export type CasePartyInsert          = typeof caseParties.$inferInsert;
export type CaseStateTransitionInsert = typeof caseStateTransitions.$inferInsert;

export async function insertCase(tx: Writer, row: CaseInsert): Promise<void> {
  await tx.insert(cases).values(row);
}

export async function insertParties(tx: Writer, rows: CasePartyInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(caseParties).values(rows);
}

export async function insertStateTransition(tx: Writer, row: CaseStateTransitionInsert): Promise<void> {
  await tx.insert(caseStateTransitions).values(row);
}

/**
 * Tenant-scoped list with optional status/court filters, newest-first. The
 * tenant predicate is always applied so a forged filter cannot widen the scan
 * beyond the caller's tenant.
 */
export async function listCases(
  filters: { tenantId: string; status?: string | undefined; courtId?: string | undefined },
  limit: number,
  offset: number,
): Promise<CaseRow[]> {
  const predicates = [eq(cases.tenantId, filters.tenantId)];
  if (filters.status) predicates.push(eq(cases.status, filters.status));
  if (filters.courtId) predicates.push(eq(cases.courtId, filters.courtId));
  return scopedRead((tx) => tx.select().from(cases)
    .where(and(...predicates))
    .orderBy(desc(cases.createdAt))
    .limit(limit)
    .offset(offset));
}

/**
 * Cases past their SLA target disposal date and not yet disposed, as of `asOf`
 * (YYYY-MM-DD), oldest-target first. Tenant-scoped (RLS + explicit predicate).
 */
export async function listOverdueCases(
  tenantId: string, asOf: string, limit: number, offset: number,
): Promise<CaseRow[]> {
  return scopedRead((tx) => tx.select().from(cases)
    .where(and(
      eq(cases.tenantId, tenantId),
      isNull(cases.disposalDate),
      lt(cases.targetDisposalDate, asOf),
    ))
    .orderBy(asc(cases.targetDisposalDate))
    .limit(limit)
    .offset(offset));
}

/**
 * Case analytics for a period [fromDate, toDate] (YYYY-MM-DD), tenant-scoped:
 * institution & disposal counts within the window, current pending count, and
 * average / oldest pendency age (days) of still-pending cases. Single aggregate
 * run inside scopedRead so RLS is enforced on the read path.
 */
export type CaseAnalytics = {
  instituted: number; disposed: number; pending: number;
  avgPendencyDays: number; oldestPendingDays: number;
};
export async function caseAnalytics(tenantId: string, fromDate: string, toDate: string): Promise<CaseAnalytics> {
  const rows = await scopedRead<Array<{
    instituted: number; disposed: number; pending: number;
    avg_pendency_days: number; oldest_pending_days: number;
  }>>((tx) => tx.execute(sql`
    select
      count(*) filter (where filing_date >= ${fromDate} and filing_date <= ${toDate})::int as instituted,
      count(*) filter (where disposal_date >= ${fromDate} and disposal_date <= ${toDate})::int as disposed,
      count(*) filter (where disposal_date is null)::int as pending,
      coalesce(avg(current_date - filing_date) filter (where disposal_date is null), 0)::int as avg_pendency_days,
      coalesce(max(current_date - filing_date) filter (where disposal_date is null), 0)::int as oldest_pending_days
    from court.cases where tenant_id = ${tenantId}
  `) as unknown as Promise<Array<{ instituted: number; disposed: number; pending: number; avg_pendency_days: number; oldest_pending_days: number }>>);
  const r = rows[0] ?? { instituted: 0, disposed: 0, pending: 0, avg_pendency_days: 0, oldest_pending_days: 0 };
  return {
    instituted: r.instituted, disposed: r.disposed, pending: r.pending,
    avgPendencyDays: r.avg_pendency_days, oldestPendingDays: r.oldest_pending_days,
  };
}

/** Pending-case counts grouped by status (disposal_date IS NULL), tenant-scoped. */
export async function pendencySummary(tenantId: string): Promise<{ status: string; count: number }[]> {
  return scopedRead<{ status: string; count: number }[]>((tx) => tx
    .select({ status: cases.status, count: sql<number>`cast(count(*) as int)` })
    .from(cases)
    .where(and(eq(cases.tenantId, tenantId), isNull(cases.disposalDate)))
    .groupBy(cases.status));
}

export async function getCaseById(tenantId: string, id: string): Promise<CaseRow | null> {
  // Read-through cache; invalidated by the case-lifecycle consumer on status change.
  return cache.getOrLoad<CaseRow>(cache.makeKey(tenantId, "case", id), async () => {
    const rows = await scopedRead<CaseRow[]>((tx) => tx.select().from(cases)
      .where(and(eq(cases.tenantId, tenantId), eq(cases.id, id))).limit(1));
    return rows[0] ?? null;
  });
}

/**
 * Tenant-scoped parties lookup. The tenant predicate is explicit (defense in
 * depth alongside RLS): without it, a caseId belonging to another tenant
 * could leak that tenant's parties (PII) if RLS were ever misconfigured or
 * bypassed on this read path.
 */
export async function getCasePartiesByCaseId(tenantId: string, caseId: string): Promise<CasePartyRow[]> {
  return scopedRead((tx) => tx.select().from(caseParties)
    .where(and(eq(caseParties.tenantId, tenantId), eq(caseParties.caseId, caseId))));
}
