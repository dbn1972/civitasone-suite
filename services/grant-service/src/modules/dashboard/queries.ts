import { eq, and, sql, gte } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../../shared/db.js";
import { grantApplications } from "../application/schema.js";
import { grantBeneficiaries } from "../beneficiary/schema.js";
import { grantComplianceReports } from "../utilisation/schema.js";
import { grantDisbursements } from "../disbursement/schema.js";

/**
 * Drizzle transaction handle accepted by *Tx() siblings in this file.
 * Preserves full column typing (the public db.transaction rewrites tx to any).
 */
type ScopedTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * G-03 compliance monitoring: find approved applications that have missed
 * their compliance reporting deadline (90 days default = quarterly).
 * Returns the application IDs that are "defaulting".
 */
export async function getOverdueApplicationIds(tenantId: string): Promise<string[]> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    return getOverdueApplicationIdsTx(tx, tenantId);
  }));
}

/**
 * TX-001 — tenant-scoped sibling of getOverdueApplicationIds(). Reads
 * through a caller-supplied transaction handle so an already-open
 * scopedRead()/db.transaction() (getDashboard(), below) does not open a
 * second, bare scopedRead() from inside itself: under pool.max concurrent
 * in-flight dashboard requests, the nested call has no free connection to
 * open on and deadlocks the pool silently. Route every call that happens
 * inside an already-open outer transaction through this, not
 * getOverdueApplicationIds().
 */
export async function getOverdueApplicationIdsTx(tx: ScopedTx, tenantId: string): Promise<string[]> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // All approved applications for this tenant
  const approvedApps = await tx
    .select({ id: grantApplications.id, approvedAt: grantApplications.approvedAt })
    .from(grantApplications)
    .where(and(eq(grantApplications.tenantId, tenantId), eq(grantApplications.status, "approved")));

  const overdueIds: string[] = [];

  for (const app of approvedApps) {
    if (!app.approvedAt) continue;
    // Only check apps approved more than 90 days ago (first reporting period has elapsed)
    if (app.approvedAt > ninetyDaysAgo) continue;

    // Check if a compliance report was submitted within the current reporting
    // window (last 90 days). Previously this matched ALL reports ever filed
    // (createdAt < now), so a single stale report marked an app compliant
    // forever — defeating overdue detection. Use gte(ninetyDaysAgo).
    const recentReports = await tx
      .select({ id: grantComplianceReports.id })
      .from(grantComplianceReports)
      .where(and(
        eq(grantComplianceReports.applicationId, app.id),
        gte(grantComplianceReports.createdAt, ninetyDaysAgo),
      ))
      .limit(1);

    // If no compliance report exists at all → defaulting
    if (recentReports.length === 0) {
      overdueIds.push(app.id);
    }
  }

  return overdueIds;
}

export async function getDashboard(tenantId: string) {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const [grants] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(grantApplications)
      .where(eq(grantApplications.tenantId, tenantId));

    const [grantees] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(grantBeneficiaries)
      .where(eq(grantBeneficiaries.tenantId, tenantId));

    const [pendingUcs] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(grantApplications)
      .where(and(eq(grantApplications.tenantId, tenantId), eq(grantApplications.status, "submitted")));

    // TX-001: was a bare getOverdueApplicationIds(tenantId) call, which opens
    // its OWN nested scopedRead()/db.transaction() from inside this already-
    // open outer scopedRead() — a second connection borrowed from the same
    // pool while the outer one is still held. Under pool.max concurrent
    // dashboard requests this has no free connection to open on and
    // deadlocks the pool silently. Route through the *Tx sibling instead,
    // reusing this outer tx.
    const overdueIds = await getOverdueApplicationIdsTx(tx, tenantId);

    // Real tenant-wide disbursed total: sum of COMPLETED disbursements (paise → rupees).
    const [disbursed] = await tx
      .select({ total: sql<string>`coalesce(sum(${grantDisbursements.amountMinor}), 0)::text` })
      .from(grantDisbursements)
      .where(and(eq(grantDisbursements.tenantId, tenantId), eq(grantDisbursements.status, "completed")));
    const disbursedAmount = Number(BigInt(disbursed?.total ?? "0")) / 100;

    return {
      totalGrants: grants?.count ?? 0,
      disbursedAmount,
      pendingUCs: pendingUcs?.count ?? 0,
      totalGrantees: grantees?.count ?? 0,
      overdueGrants: overdueIds.length,
      overdueGrantIds: overdueIds,
    };
  }));
}
