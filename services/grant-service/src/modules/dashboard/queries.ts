import { eq, and, sql, gte } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../../shared/db.js";
import { grantApplications } from "../application/schema.js";
import { grantBeneficiaries } from "../beneficiary/schema.js";
import { grantComplianceReports } from "../utilisation/schema.js";
import { grantDisbursements } from "../disbursement/schema.js";

/**
 * G-03 compliance monitoring: find approved applications that have missed
 * their compliance reporting deadline (90 days default = quarterly).
 * Returns the application IDs that are "defaulting".
 */
export async function getOverdueApplicationIds(tenantId: string): Promise<string[]> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
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
  }));
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

    const overdueIds = await getOverdueApplicationIds(tenantId);

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
