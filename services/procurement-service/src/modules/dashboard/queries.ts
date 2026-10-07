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

    // "This month" = the current calendar month in the TENANT timezone
    // (Asia/Kolkata), not the DB server's clock, and only GRNs that were
    // actually ACCEPTED — a goods-receipt KPI counts completed receipts, not
    // drafts/under-inspection/rejected rows (GAP-PROCUREMENT-DASHBOARD-05).
    //
    // Two bugs fixed here:
    //  1) Timezone: `date_trunc('month', now())` evaluates in the DB session
    //     timezone (UTC in our deployment), so for the first 5.5 hours of IST
    //     on the 1st — i.e. 18:30-24:00 UTC on the last day of the previous
    //     month — a GRN received "today" in IST would fall on the wrong side
    //     of the UTC month boundary. `now() AT TIME ZONE 'Asia/Kolkata'`
    //     yields the IST wall-clock timestamp, so the truncated month start is
    //     the IST calendar month. receivedDate is a bare DATE, so comparing it
    //     against IST calendar-month bounds needs no further conversion.
    //  2) Status: previously every GRN status (draft, under_inspection,
    //     received, quality_check, partially_rejected, rejected, accepted) in
    //     the month was counted; only `accepted` represents a completed
    //     goods receipt.
    const [grnsRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(procurementGrns)
      .where(and(
        eq(procurementGrns.tenantId, tenantId),
        eq(procurementGrns.status, "accepted"),
        sql`${procurementGrns.receivedDate} >= date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date`,
        sql`${procurementGrns.receivedDate} < date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date + interval '1 month'`,
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
