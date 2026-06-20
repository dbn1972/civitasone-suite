import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { grantApplications } from "../application/schema.js";
import { grantBeneficiaries } from "../beneficiary/schema.js";

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

  return {
    totalGrants: grants?.count ?? 0,
    disbursedAmount: 0,
    pendingUCs: pendingUcs?.count ?? 0,
    totalGrantees: grantees?.count ?? 0,
  };
}
