"use client";

import { useTranslations } from "next-intl";
import { Chart } from "../../../_components/Chart";
import { EmptyState } from "../../../_components/ds";
import { formatMoney, formatRupees } from "@/lib/formatters";
import { computeBudgetSplit } from "./budgetSplit";

interface BudgetChartProps {
  utilisationPct: number | null;
  /** Total expenditure in MINOR UNITS (paise), as finance-service sends it. */
  expenditure: number;
  /** Total budget estimate (BE) in minor units (paise string), when the API supplies it. */
  sanctionedMinor?: string | null;
  /**
   * Expenditure by category, exactly as finance-service reports it (paise strings). Absent/empty = the service does
   * not report a split yet: say so, and draw nothing (GAP-FINANCE-DASHBOARD-01 -- no invented shares).
   */
  categoryBreakdown?: ReadonlyArray<{ label: string; amountMinor: string }> | undefined;
}

/** Paise -> rupees, for CHART GEOMETRY ONLY (the generic <Chart> prints rupee numbers). All shown money goes through formatMoney. */
function paiseToRupeesForChart(minor: bigint): number {
  return Number(minor) / 100;
}

export function BudgetChart({ utilisationPct, expenditure, sanctionedMinor, categoryBreakdown }: BudgetChartProps) {
  const t = useTranslations("financeDashboard");
  const split = computeBudgetSplit({ utilisationPct, expenditure, sanctionedMinor });
  // The supplied amounts, as exact bigint paise. Bars are drawn from the paise value itself (scale does not matter for
  // proportions) and labelled through formatMoney, so a label is the supplied amount, never a percentage of anything.
  const categories = (categoryBreakdown ?? []).filter((c) => /^\d+$/.test(c.amountMinor)).map((c) => ({ label: c.label, minor: BigInt(c.amountMinor) }));
  const barsAreExact = categories.every((c) => c.minor <= BigInt(Number.MAX_SAFE_INTEGER));

  let donut: { label: string; value: number; color: string }[] = [];
  let banner: React.ReactNode = null;

  if (split.kind === "no-budget") {
    // GAP-FINANCE-DASHBOARD-04: an unknown/absent budget estimate is not "₹0.00 remaining".
    banner = (
      <EmptyState
        icon="📉"
        title="No budget estimate"
        message={`Budget utilisation can't be shown until a budget estimate is on record for this financial year.${split.expenditureMinor > 0n ? ` Expenditure recorded so far: ${formatMoney(split.expenditureMinor)}.` : ""}`}
      />
    );
  } else if (split.kind === "overspent") {
    donut = [
      { label: `Within estimate (${formatMoney(split.sanctionedMinor)})`, value: paiseToRupeesForChart(split.sanctionedMinor), color: "var(--chart-1)" },
      { label: `Over estimate (${formatMoney(split.overspentMinor)})`, value: paiseToRupeesForChart(split.overspentMinor), color: "var(--chart-warn)" },
    ];
    banner = (
      <p role="status" style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "var(--chart-warn)" }}>
        <span aria-hidden="true">⚠ </span>Over budget estimate by {formatMoney(split.overspentMinor)}
      </p>
    );
  } else if (split.kind === "over-budget") {
    // Older API: no exact estimate, so no amount (D1).
    donut = [{ label: `Utilized (${formatMoney(split.expenditureMinor)})`, value: paiseToRupeesForChart(split.expenditureMinor), color: "var(--chart-warn)" }];
    banner = (
      <p role="status" style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "var(--chart-warn)" }}>
        <span aria-hidden="true">⚠ </span>Over budget
      </p>
    );
  } else {
    donut = [
      { label: `Utilized (${formatMoney(split.expenditureMinor)})`, value: paiseToRupeesForChart(split.expenditureMinor), color: "var(--chart-1)" },
      {
        label: `Remaining (${split.remainingMinor === null ? "—" : formatMoney(split.remainingMinor)})`,
        value: split.remainingMinor === null ? 0 : paiseToRupeesForChart(split.remainingMinor),
        color: "var(--chart-neutral)",
      },
    ];
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
      <div style={{ flex: "1 1 200px" }}>
        {banner && (split.kind === "overspent" || split.kind === "over-budget") ? banner : null}
        {split.kind === "no-budget" ? banner : (
          <Chart type="donut" data={donut} title="Budget Utilisation" height={160} valueFormatter={formatRupees} />
        )}
      </div>
      <div style={{ flex: "2 1 300px" }}>
        {/* GAP-FINANCE-DASHBOARD-01: this used to draw "Expenditure by Category"
            from hard-coded shares (35/25/20/12/8%) of total spend -- a plausible
            chart that was not the officer's data, and it printed in Export MIS.
            Bars are drawn ONLY from a categoryBreakdown the finance service
            reports; without one, say so instead of inventing a split. */}
        {categories.length === 0 ? (
          <EmptyState
            icon="📊"
            title="Category breakdown not available"
            message="Expenditure by category will appear here once the finance service reports a category split."
          />
        ) : barsAreExact ? (
          <Chart
            type="bar"
            title={t("categoryChart")}
            height={200}
            data={categories.map((c) => ({ label: c.label, value: Number(c.minor) }))}
            valueFormatter={(paise) => formatMoney(BigInt(Math.trunc(paise)))}
          />
        ) : (
          // An amount beyond 2^53 paise cannot be drawn exactly as a number: list the exact figures instead of a bar.
          <div>
            <h4 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 600 }}>{t("categoryChart")}</h4>
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {categories.map((c, i) => <li key={i}>{c.label}: {formatMoney(c.minor)}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
