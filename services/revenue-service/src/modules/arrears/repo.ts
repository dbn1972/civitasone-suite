import { tenantTransaction } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { instalmentPlans, instalments, writeOffs, recoveryReferrals } from "./schema.js";
// GAP-REVENUE-WAIVERS-03: waivers live in the revenue schema (trade-license
// module's schema.ts); the arrears consumer already reads/writes this table for
// waiver create/decide, so the decide screen's single-record fetch is added
// here alongside the other arrears maker-checker reads for consistency.
import { waivers } from "../trade-license/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";

export async function listInstalmentPlans(
  tenantId: string,
  assesseeId: string,
  pagination: { limit: number; offset: number },
) {
  return tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    const where = and(eq(instalmentPlans.tenantId, tenantId), eq(instalmentPlans.assesseeId, assesseeId));
    const rows = await t
      .select()
      .from(instalmentPlans)
      .where(where)
      .orderBy(desc(instalmentPlans.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset);
    const counted = await t.select({ n: sql<number>`count(*)::int` }).from(instalmentPlans).where(where);
    return { rows: rows ?? [], total: Number(counted[0]?.n ?? 0) };
  });
}

/**
 * Fetch a single write-off by id, tenant-scoped. Used by the maker-checker
 * decide screen so a checker never approves/rejects blind — the caller
 * needs amountMinor + the reason + who raised it before deciding.
 */
export async function findWriteOffById(tenantId: string, id: string) {
  const rows = await tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    return t
      .select()
      .from(writeOffs)
      .where(and(eq(writeOffs.tenantId, tenantId), eq(writeOffs.id, id)))
      .limit(1);
  });
  return rows[0] ?? null;
}

/**
 * GAP-REVENUE-WRITE-OFFS-02: list write-offs for the tenant, optionally
 * filtered by status (e.g. ?status=pending for the checker's approval queue),
 * newest first and paginated. Tenant-scoped via tenantTransaction (RLS) and the
 * explicit tenantId predicate — a checker must be able to DISCOVER pending
 * write-offs rather than paste a UUID from the maker.
 */
export async function listWriteOffs(
  tenantId: string,
  opts: { status?: string; limit: number; offset: number },
) {
  const rows = await tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    const where = opts.status
      ? and(eq(writeOffs.tenantId, tenantId), eq(writeOffs.status, opts.status))
      : eq(writeOffs.tenantId, tenantId);
    const page = await t
      .select()
      .from(writeOffs)
      .where(where)
      .orderBy(desc(writeOffs.createdAt))
      .limit(opts.limit)
      .offset(opts.offset);
    const counted = await t.select({ n: sql<number>`count(*)::int` }).from(writeOffs).where(where);
    return { rows: page ?? [], total: Number(counted[0]?.n ?? 0) };
  });
  return rows;
}

/**
 * GAP-REVENUE-WAIVERS-03: fetch a single waiver by id, tenant-scoped, so the
 * maker-checker decide screen can show the checker the amount/demand/reason and
 * who raised it before approving or rejecting — never decide blind on a bare
 * UUID (mirrors findWriteOffById / findRefundById).
 */
export async function findWaiverById(tenantId: string, id: string) {
  const rows = await tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    return t
      .select()
      .from(waivers)
      .where(and(eq(waivers.tenantId, tenantId), eq(waivers.id, id)))
      .limit(1);
  });
  return rows[0] ?? null;
}

/**
 * GAP-REVENUE-RECOVERY-02: the recovery register — list referrals for the
 * tenant, newest first, optionally filtered to one assessee. A coercive
 * referral takes effect immediately and must be auditable (who referred whom,
 * when, with what reason), so the UI needs a read path, not just the POST.
 * Tenant-scoped via tenantTransaction/RLS.
 */
export async function listRecoveryReferrals(
  tenantId: string,
  pagination: { limit: number; offset: number },
  assesseeId?: string,
) {
  return tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    const where = assesseeId
      ? and(eq(recoveryReferrals.tenantId, tenantId), eq(recoveryReferrals.assesseeId, assesseeId))
      : eq(recoveryReferrals.tenantId, tenantId);
    const rows = await t
      .select()
      .from(recoveryReferrals)
      .where(where)
      .orderBy(desc(recoveryReferrals.referredAt))
      .limit(pagination.limit)
      .offset(pagination.offset);
    const counted = await t.select({ n: sql<number>`count(*)::int` }).from(recoveryReferrals).where(where);
    return { rows: rows ?? [], total: Number(counted[0]?.n ?? 0) };
  });
}

/**
 * GAP-REVENUE-INSTALMENTS-02: fetch a single instalment plan plus its schedule
 * lines, tenant-scoped, so the plan detail page can show the per-instalment
 * breakdown that sums to the plan total. Returns null when the plan does not
 * exist for the tenant.
 */
export async function findInstalmentPlanById(tenantId: string, id: string) {
  return tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    const planRows = await t
      .select()
      .from(instalmentPlans)
      .where(and(eq(instalmentPlans.tenantId, tenantId), eq(instalmentPlans.id, id)))
      .limit(1);
    const plan = planRows[0];
    if (!plan) return null;
    const scheduleRows = await t
      .select()
      .from(instalments)
      .where(and(eq(instalments.tenantId, tenantId), eq(instalments.planId, id)))
      .orderBy(instalments.sequenceNo);
    return { ...plan, schedule: scheduleRows };
  });
}
