import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { financeSanctions } from "../budget/schema.js";
import { financePayments } from "../payments/schema.js";
import { financeLedger } from "../gl/schema.js";

export async function getDashboard(tenantId: string) {
  const [pendingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(financeSanctions)
    .where(and(eq(financeSanctions.tenantId, tenantId), eq(financeSanctions.status, "pending")));

  const [payRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(financePayments)
    .where(eq(financePayments.tenantId, tenantId));

  const [expRow] = await db
    .select({ total: sql<number>`coalesce(sum(${financeLedger.debitMinor}), 0)::bigint` })
    .from(financeLedger)
    .where(eq(financeLedger.tenantId, tenantId));

  return {
    budgetUtilisationPct: 0,
    pendingSanctions: pendingRow?.count ?? 0,
    paymentsThisMonth: payRow?.count ?? 0,
    totalExpenditure: Number(expRow?.total ?? 0) / 100,
  };
}
