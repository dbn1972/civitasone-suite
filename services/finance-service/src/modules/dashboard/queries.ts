import { eq, and, sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { financeSanctions, financeBudgets } from "../budget/schema.js";
import { financePayments } from "../payments/schema.js";
import { financeLedger } from "../gl/schema.js";

/**
 * UX-006: null when there is no sanctioned budget (BE) on record for this
 * tenant/FY to compute utilisation against — not "a ₹0 budget, 0% used".
 * Fabricating 0 here is indistinguishable from a genuine zero-percent
 * utilisation against a real budget, and was actively misleading: real,
 * non-zero expenditure (financeLedger has posted debits) can exist with zero
 * rows in financeBudgets (budget formulation simply hasn't happened yet for
 * this tenant/FY), which previously still rendered a confident-looking
 * "0.0%" instead of surfacing that the utilisation is genuinely unknown/not
 * applicable. `null` here flows through FinanceDashboardSchema and the
 * frontend's formatPercent() to render "—", matching the same missing-data
 * convention formatMoney/formatRupees/formatBps already use.
 *
 * Exported (pure, no DB) so this exact rule is unit-testable directly.
 */
export function computeBudgetUtilisationPct(expenditureMinor: number, sanctionedMinor: number): number | null {
  return sanctionedMinor > 0 ? Math.round((expenditureMinor / sanctionedMinor) * 100) : null;
}

export async function getDashboard(tenantId: string) {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "dashboard", "summary"),
    async () => {
      return scopedRead(async (tx) => {
        const [[pendingRow], [payRow], [expRow], [budgetRow]] = await Promise.all([
          tx.select({ count: sql<number>`count(*)::int` })
            .from(financeSanctions)
            .where(and(eq(financeSanctions.tenantId, tenantId), eq(financeSanctions.status, "pending"))),
          tx.select({ count: sql<number>`count(*)::int` })
            .from(financePayments)
            .where(eq(financePayments.tenantId, tenantId)),
          tx.select({ total: sql<number>`coalesce(sum(${financeLedger.debitMinor}), 0)::bigint` })
            .from(financeLedger)
            .where(eq(financeLedger.tenantId, tenantId)),
          tx.select({ totalBE: sql<number>`coalesce(sum(be_minor), 0)::bigint` })
            .from(financeBudgets)
            .where(eq(financeBudgets.tenantId, tenantId)),
        ]);
        const sanctioned = Number(budgetRow?.totalBE ?? 0);
        const expenditure = Number(expRow?.total ?? 0);
        const budgetUtilisationPct = computeBudgetUtilisationPct(expenditure, sanctioned);
        return {
          budgetUtilisationPct,
          pendingSanctions: pendingRow?.count ?? 0,
          paymentsThisMonth: payRow?.count ?? 0,
          // Minor units (paise) — formatMoney() on the frontend expects this
          // scale directly. Dividing by 100 here previously sent rupees,
          // which formatMoney() then re-divided again, rendering every
          // amount 100x too small (the same bug fixed in gl/queries.ts).
          totalExpenditure: Number(expRow?.total ?? 0),
        };
      });
    },
    30,
  );
}
