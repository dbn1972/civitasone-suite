import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { financeSanctions, financeBudgets } from "../budget/schema.js";
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

  const [budgetRow] = await db
    .select({
      totalBE: sql<number>`coalesce(sum(be_minor), 0)::bigint`,
    })
    .from(financeBudgets)
    .where(eq(financeBudgets.tenantId, tenantId));

  const sanctioned = Number(budgetRow?.totalBE ?? 0);
  const expenditure = Number(expRow?.total ?? 0);
  const budgetUtilisationPct = sanctioned > 0 ? Math.round((expenditure / sanctioned) * 100) : 0;

  return {
    budgetUtilisationPct,
    pendingSanctions: pendingRow?.count ?? 0,
    paymentsThisMonth: payRow?.count ?? 0,
    totalExpenditure: Number(expRow?.total ?? 0) / 100,
  };
}
