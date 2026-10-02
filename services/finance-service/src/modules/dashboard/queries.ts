import { eq, and, gte, lte, sql } from "drizzle-orm";
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

/**
 * GAP-FINANCE-DASHBOARD-04: the budget-estimate total as a bigint-safe decimal
 * string (paise). The aggregate arrives as a numeric string from the driver.
 * Missing or unparseable input is `undefined` (field omitted, "unknown"), never
 * "0": the UI reads "0" as "no budget estimate on record".
 */
export function sanctionedMinorString(totalBE: unknown): string | undefined {
  if (totalBE === null || totalBE === undefined || totalBE === "") return undefined;
  try {
    return BigInt(totalBE as string | number | bigint).toString();
  } catch {
    return undefined;
  }
}

/**
 * GAP-FINANCE-DASHBOARD-02: Indian fiscal-year bounds ("2026-27" ->
 * 2026-04-01..2027-03-31). Returns null for anything that is not a real,
 * consecutive FY label so a typo can never silently widen or shift the window.
 */
export function fyDateBounds(fy: string): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m) return null;
  const startYear = Number(m[1]);
  if (Number(m[2]) !== (startYear + 1) % 100) return null;
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

/**
 * `fy` (optional): scope expenditure to ledger postings dated inside that FY
 * and budget estimates to that FY. Omitted -> legacy all-time totals.
 */
export async function getDashboard(tenantId: string, fy?: string) {
  const bounds = fy ? fyDateBounds(fy) : null;
  if (fy && !bounds) throw new Error("invalid fiscal year");
  return cache.getOrLoad(
    cache.makeKey(tenantId, "dashboard", `summary:${fy ?? "all"}`),
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
            .where(bounds
              ? and(eq(financeLedger.tenantId, tenantId), gte(financeLedger.postingDate, bounds.start), lte(financeLedger.postingDate, bounds.end))
              : eq(financeLedger.tenantId, tenantId)),
          tx.select({ totalBE: sql<number>`coalesce(sum(be_minor), 0)::bigint` })
            .from(financeBudgets)
            .where(fy
              ? and(eq(financeBudgets.tenantId, tenantId), eq(financeBudgets.fy, fy))
              : eq(financeBudgets.tenantId, tenantId)),
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
          // GAP-FINANCE-DASHBOARD-04: the budget-estimate total (paise, decimal
          // string). NOTE: BE ONLY (`sum(be_minor)`): no RE / re-appropriation and
          // not the sanctions table, so the UI calls it a "budget estimate". Lets it
          // derive "remaining"/"over estimate" by exact subtraction instead of
          // back-computing from the rounded percentage.
          sanctionedMinor: sanctionedMinorString(budgetRow?.totalBE),
        };
      });
    },
    30,
  );
}
