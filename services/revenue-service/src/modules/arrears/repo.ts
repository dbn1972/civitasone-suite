import { tenantTransaction } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { instalmentPlans, instalments, writeOffs, recoveryReferrals, demandNotices } from "./schema.js";
// GAP-REVENUE-WAIVERS-03: waivers live in the revenue schema (trade-license
// module's schema.ts); the arrears consumer already reads/writes this table for
// waiver create/decide, so the decide screen's single-record fetch is added
// here alongside the other arrears maker-checker reads for consistency.
import { waivers } from "../trade-license/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { demands } from "../assessment/schema.js";
import { assessees } from "../assessee/schema.js";
import { getLatestDemandBalance, getAssesseeOutstanding } from "./outstanding.js";
import { listNoticesTx, loadNoticeDefaultTx } from "./recovery-notice.js";

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

/** Owner decision #4: one referral by id, tenant-scoped (the decide screen + the route pre-check). */
export async function findRecoveryReferralById(tenantId: string, id: string) {
  const rows = await tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    return t
      .select()
      .from(recoveryReferrals)
      .where(and(eq(recoveryReferrals.tenantId, tenantId), eq(recoveryReferrals.id, id)))
      .limit(1);
  });
  return rows[0] ?? null;
}

/**
 * Owner decision #4: what the officer needs to see BEFORE raising a coercive
 * referral — the live outstanding (latest balance per demand), the demand
 * notices served and whether their period has lapsed, and the resulting
 * eligibility. The consumer enforces the same rules in-transaction.
 */
export async function getRecoveryReadiness(tenantId: string, assesseeId: string) {
  return tenantTransaction(db, tenantId, async (tx) => {
    const outstanding = await getAssesseeOutstanding(tx, tenantId, assesseeId);
    const notices = await listNoticesTx(tx, tenantId, assesseeId);
    return {
      outstandingMinor: outstanding,
      notices,
      eligible: outstanding > 0n && notices.some((n) => n.lapsed),
    };
  });
}

/**
 * Owner decision #3: tenant-scoped, paginated instalment plans across all
 * assessees, optionally by status, so a second officer can DISCOVER plans
 * awaiting approval (?status=pending) instead of being handed a UUID.
 */
export async function listInstalmentPlansByStatus(
  tenantId: string,
  opts: { status?: string; limit: number; offset: number },
) {
  return tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    const where = opts.status
      ? and(eq(instalmentPlans.tenantId, tenantId), eq(instalmentPlans.status, opts.status))
      : eq(instalmentPlans.tenantId, tenantId);
    const rows = await t
      .select()
      .from(instalmentPlans)
      .where(where)
      .orderBy(desc(instalmentPlans.createdAt))
      .limit(opts.limit)
      .offset(opts.offset);
    const counted = await t.select({ n: sql<number>`count(*)::int` }).from(instalmentPlans).where(where);
    return { rows: rows ?? [], total: Number(counted[0]?.n ?? 0) };
  });
}

/**
 * Owner decision #6: the demand a new write-off targets — its assessee, FY and
 * live DCB balance (latest running balance). Null when the demand does not
 * exist for the tenant. Tenant-scoped via tenantTransaction/RLS.
 */
export async function getWriteOffTarget(tenantId: string, demandId: string) {
  return tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    const d = await t
      .select({ assesseeId: demands.assesseeId, financialYear: demands.financialYear })
      .from(demands)
      .where(and(eq(demands.tenantId, tenantId), eq(demands.id, demandId)))
      .limit(1);
    if (!d[0]) return null;
    const balance = await getLatestDemandBalance(t, tenantId, demandId);
    return { assesseeId: d[0].assesseeId, financialYear: d[0].financialYear, balanceMinor: balance };
  });
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
 * Tenant-scoped, paginated waiver list (newest first), optionally filtered by
 * status, so the checker's waivers page can DISCOVER pending waivers instead of
 * pasting a UUID from the maker (mirrors listWriteOffs).
 */
export async function listWaivers(
  tenantId: string,
  opts: { status?: string; limit: number; offset: number },
) {
  return tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    const where = opts.status
      ? and(eq(waivers.tenantId, tenantId), eq(waivers.status, opts.status))
      : eq(waivers.tenantId, tenantId);
    const page = await t
      .select()
      .from(waivers)
      .where(where)
      .orderBy(desc(waivers.createdAt))
      .limit(opts.limit)
      .offset(opts.offset);
    const counted = await t.select({ n: sql<number>`count(*)::int` }).from(waivers).where(where);
    return { rows: page ?? [], total: Number(counted[0]?.n ?? 0) };
  });
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
  status?: string,
) {
  return tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    const conds = [eq(recoveryReferrals.tenantId, tenantId)];
    if (assesseeId) conds.push(eq(recoveryReferrals.assesseeId, assesseeId));
    if (status) conds.push(eq(recoveryReferrals.status, status));
    const where = and(...conds);
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

/**
 * Synchronous pre-check for POST /demand-notices (same pattern as
 * GAP-REVENUE-ASSESSEES-03): the serve consumer runs after the 202, so an
 * unknown assessee, a demand that is not the assessee's or a duplicate noticeNo
 * would otherwise fail silently in the background. Uncached; tenant-scoped.
 * The unique index uq_demand_notices_tenant_no stays the authoritative backstop.
 */
export async function precheckDemandNotice(
  tenantId: string,
  input: { assesseeId: string; demandId?: string | undefined; noticeNo: string },
) {
  return tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    const a = await t
      .select({ id: assessees.id })
      .from(assessees)
      .where(and(eq(assessees.tenantId, tenantId), eq(assessees.id, input.assesseeId)))
      .limit(1);
    const dup = await t
      .select({ id: demandNotices.id })
      .from(demandNotices)
      .where(and(eq(demandNotices.tenantId, tenantId), eq(demandNotices.noticeNo, input.noticeNo)))
      .limit(1);
    let demandAssesseeId: string | null | undefined;
    if (input.demandId) {
      const d = await t
        .select({ assesseeId: demands.assesseeId })
        .from(demands)
        .where(and(eq(demands.tenantId, tenantId), eq(demands.id, input.demandId)))
        .limit(1);
      demandAssesseeId = d[0]?.assesseeId ?? null;
    }
    const def = await loadNoticeDefaultTx(t, tenantId);
    return { assesseeExists: a.length > 0, noticeExists: dup.length > 0, demandAssesseeId, defaultNoticePeriodDays: def.days };
  });
}

/** Owner decision F1: the tenant default notice period (15 until configured). */
export async function getNoticeSettings(tenantId: string) {
  return tenantTransaction(db, tenantId, async (tx) => {
    const def = await loadNoticeDefaultTx(tx as typeof db, tenantId);
    return { defaultNoticePeriodDays: def.days, seeded: def.seeded };
  });
}
