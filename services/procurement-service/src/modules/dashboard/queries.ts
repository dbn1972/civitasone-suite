import { eq, and, or, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementIndents } from "../indent/schema.js";
import { procurementPos } from "../po/schema.js";
import { procurementGrns } from "../grn/schema.js";

export async function getDashboard(tenantId: string) {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before these reads — bare db.select() calls run with no RLS GUC set.
  const [pendingIndents, activePos, grns] = await db.transaction(async (tx) => {
    const [pendingIndentsRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(procurementIndents)
      .where(and(
        eq(procurementIndents.tenantId, tenantId),
        or(eq(procurementIndents.status, "draft"), eq(procurementIndents.status, "pending")),
      ));

    const [activePosRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(procurementPos)
      .where(and(eq(procurementPos.tenantId, tenantId), eq(procurementPos.status, "approved")));

    // "This month" = current calendar month at the DB server's clock, not the
    // lifetime GRN count — bug fix: this previously had no date filter at all,
    // so "GRNs (MTD)" on the dashboard silently showed the all-time total.
    const [grnsRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(procurementGrns)
      .where(and(
        eq(procurementGrns.tenantId, tenantId),
        sql`${procurementGrns.receivedDate} >= date_trunc('month', now())::date`,
        sql`${procurementGrns.receivedDate} < date_trunc('month', now())::date + interval '1 month'`,
      ));

    return [pendingIndentsRow, activePosRow, grnsRow] as const;
  });

  return {
    pendingIndents: pendingIndents?.count ?? 0,
    activePOs: activePos?.count ?? 0,
    grnsThisMonth: grns?.count ?? 0,
    // contractRenewalsDue is intentionally not computed here yet: contract
    // renewals live in contract-service, a separate physical database, and
    // this dashboard has no cross-service read for it (see the precedent for
    // internal service-to-service reads in services/inventory-service/src/
    // modules/srn/grn-client.ts and services/payroll-service/src/shared/
    // hrms-client.ts). Hardcoding 0 here is a known gap, not a real "zero due"
    // — flagged for a follow-up rather than silently left looking correct.
    contractRenewalsDue: 0,
  };
}
