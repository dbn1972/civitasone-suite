import { eq, and, sql, lt } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { grantApplications } from "../application/schema.js";
import { grantBeneficiaries } from "../beneficiary/schema.js";
import { grantComplianceReports } from "../utilisation/schema.js";

/**
 * G-03 compliance monitoring: find approved applications that have missed
 * their compliance reporting deadline (90 days default = quarterly).
 * Returns the application IDs that are "defaulting".
 */
export async function getOverdueApplicationIds(tenantId: string): Promise<string[]> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // All approved applications for this tenant
  const approvedApps = await db
    .select({ id: grantApplications.id, approvedAt: grantApplications.approvedAt })
    .from(grantApplications)
    .where(and(eq(grantApplications.tenantId, tenantId), eq(grantApplications.status, "approved")));

  const overdueIds: string[] = [];

  for (const app of approvedApps) {
    if (!app.approvedAt) continue;
    // Only check apps approved more than 90 days ago (first reporting period has elapsed)
    if (app.approvedAt > ninetyDaysAgo) continue;

    // Check if any compliance report was submitted in the last 90 days
    const recentReports = await db
      .select({ id: grantComplianceReports.id })
      .from(grantComplianceReports)
      .where(and(
        eq(grantComplianceReports.applicationId, app.id),
        lt(grantComplianceReports.createdAt, new Date()),
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
  const [grants] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(grantApplications)
    .where(eq(grantApplications.tenantId, tenantId));

  const [grantees] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(grantBeneficiaries)
    .where(eq(grantBeneficiaries.tenantId, tenantId));

  const [pendingUcs] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(grantApplications)
    .where(and(eq(grantApplications.tenantId, tenantId), eq(grantApplications.status, "submitted")));

  const overdueIds = await getOverdueApplicationIds(tenantId);

  return {
    totalGrants: grants?.count ?? 0,
    disbursedAmount: 0,
    pendingUCs: pendingUcs?.count ?? 0,
    totalGrantees: grantees?.count ?? 0,
    overdueGrants: overdueIds.length,
    overdueGrantIds: overdueIds,
  };
}
