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

    const [grnsRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(procurementGrns)
      .where(eq(procurementGrns.tenantId, tenantId));

    return [pendingIndentsRow, activePosRow, grnsRow] as const;
  });

  return {
    pendingIndents: pendingIndents?.count ?? 0,
    activePOs: activePos?.count ?? 0,
    grnsThisMonth: grns?.count ?? 0,
    contractRenewalsDue: 0,
  };
}
